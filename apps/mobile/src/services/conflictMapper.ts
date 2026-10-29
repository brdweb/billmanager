import {
  ConflictResponseBody,
  OutboxMutation,
  SyncConflict,
  SyncConflictReason,
} from '../domain/sync';

interface HttpErrorLike {
  response?: {
    status?: number;
    data?: ConflictResponseBody;
  };
}

function reasonFromBody(body: ConflictResponseBody): SyncConflictReason {
  const candidate = body.conflict?.reason ?? body.data?.reason ?? body.reason ?? body.code;
  if (candidate === 'deleted' || candidate === 'not_found') return 'deleted';
  if (
    candidate === 'permission_changed' ||
    candidate === 'forbidden' ||
    candidate === 'tenant_changed'
  ) {
    return 'permission_changed';
  }
  return 'modified';
}

export function mapSyncConflict(
  error: unknown,
  mutation: OutboxMutation,
  now = new Date().toISOString(),
): SyncConflict | null {
  const response = (error as HttpErrorLike)?.response;
  const status = response?.status;
  if (status !== 400 && status !== 401 && status !== 403 && status !== 404 && status !== 409) {
    return null;
  }

  const body = response?.data ?? {};
  const serverFromResponse = body.conflict?.server
    ?? body.data?.server_data
    ?? body.data?.entity
    ?? body.server_data;
  const server = serverFromResponse ?? {
      __sync_failure: true,
      status,
      code: body.code,
      error: body.error ?? 'The server rejected this queued change.',
    };
  const serverUpdatedAt = body.conflict?.server_updated_at
    ?? body.data?.server_updated_at
    ?? body.server_updated_at
    ?? mutation.baseUpdatedAt
    ?? mutation.createdAt;
  const reason: SyncConflictReason = status === 401 || status === 403
    ? 'permission_changed'
    : status === 404
      ? 'deleted'
      : reasonFromBody(body);

  return {
    mutationId: mutation.id,
    serverProfileId: mutation.serverProfileId,
    databaseId: mutation.databaseId,
    ...(mutation.principalId ? { principalId: mutation.principalId } : {}),
    entity: mutation.entity,
    entityId: mutation.entityId,
    local: mutation.payload,
    server,
    serverUpdatedAt,
    reason,
    createdAt: now,
  };
}

export function errorMessage(error: unknown): string {
  const response = (error as HttpErrorLike)?.response;
  const body = response?.data;
  if (typeof body?.error === 'string') return body.error;
  if (error instanceof Error) return error.message;
  return 'Synchronization failed';
}
