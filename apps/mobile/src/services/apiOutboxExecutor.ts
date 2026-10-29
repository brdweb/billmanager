import type { BillManagerApi } from '../api/client';
import {
  OutboxMutation,
  OutboxMutationExecutor,
  OutboxMutationResult,
} from '../domain/sync';

interface MutationPayload extends Record<string, unknown> {
  bill_id?: string | number;
}

interface ApiEnvelope {
  data?: unknown;
  server_updated_at?: string;
}

function requireEntityId(mutation: OutboxMutation): string {
  if (!mutation.entityId) {
    throw new Error(`${mutation.entity} ${mutation.operation} requires an entity id`);
  }
  return encodeURIComponent(mutation.entityId);
}

function routeForMutation(mutation: OutboxMutation): {
  method: 'POST' | 'PUT' | 'DELETE';
  path: string;
  payload: MutationPayload;
} {
  const payload = { ...(mutation.payload as MutationPayload) };

  switch (mutation.entity) {
    case 'bill':
      if (mutation.operation === 'create') return { method: 'POST', path: '/bills', payload };
      if (mutation.operation === 'update') {
        return { method: 'PUT', path: `/bills/${requireEntityId(mutation)}`, payload };
      }
      throw new Error(`Unsupported offline bill operation: ${mutation.operation}`);

    case 'bill_archive':
      return { method: 'DELETE', path: `/bills/${requireEntityId(mutation)}`, payload };

    case 'bill_restore':
      return { method: 'POST', path: `/bills/${requireEntityId(mutation)}/unarchive`, payload };

    case 'payment':
      if (mutation.operation === 'create') {
        const billId = payload.bill_id;
        if (billId === undefined) throw new Error('Offline payment creation requires bill_id');
        delete payload.bill_id;
        return {
          method: 'POST',
          path: `/bills/${encodeURIComponent(String(billId))}/pay`,
          payload,
        };
      }
      if (mutation.operation === 'update') {
        return { method: 'PUT', path: `/payments/${requireEntityId(mutation)}`, payload };
      }
      if (mutation.operation === 'delete') {
        return { method: 'DELETE', path: `/payments/${requireEntityId(mutation)}`, payload };
      }
      throw new Error(`Unsupported offline payment operation: ${mutation.operation}`);

    case 'reminder_settings':
      return { method: 'PUT', path: `/bills/${requireEntityId(mutation)}`, payload };
  }
}

export class ApiOutboxMutationExecutor implements OutboxMutationExecutor {
  constructor(private readonly api: Pick<BillManagerApi, 'requestScopedMutation'>) {}

  async execute(mutation: OutboxMutation): Promise<OutboxMutationResult> {
    const route = routeForMutation(mutation);
    const response = await this.api.requestScopedMutation<ApiEnvelope>(
      route.method,
      route.path,
      route.payload,
      {
        clientMutationId: mutation.id,
        baseUpdatedAt: mutation.baseUpdatedAt,
      },
      {
        serverProfileId: mutation.serverProfileId,
        databaseId: mutation.databaseId,
        ...(mutation.principalId ? { principalId: mutation.principalId } : {}),
      },
    );
    const responseData = response.data && typeof response.data === 'object'
      ? response.data as Record<string, unknown>
      : null;
    const conflictTargetUpdatedAt = mutation.entity === 'payment'
      && mutation.operation === 'create'
      && typeof responseData?.bill_last_updated === 'string'
      ? responseData.bill_last_updated
      : response.server_updated_at
        ?? (typeof responseData?.last_updated === 'string'
          ? responseData.last_updated
          : typeof responseData?.updated_at === 'string'
            ? responseData.updated_at
            : undefined);
    return {
      serverEntity: response.data,
      serverUpdatedAt: conflictTargetUpdatedAt,
    };
  }
}

export const resolveOutboxRoute = routeForMutation;
