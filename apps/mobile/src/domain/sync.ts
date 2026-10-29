export type SyncEntity =
  | 'bill'
  | 'payment'
  | 'reminder_settings'
  | 'bill_archive'
  | 'bill_restore';

export type SyncObjectKind = 'bill' | 'payment';

export function syncObjectKind(entity: SyncEntity): SyncObjectKind {
  return entity === 'payment' ? 'payment' : 'bill';
}

export function syncObjectKey(entity: SyncEntity, entityId: string | null): string | null {
  return entityId ? `${syncObjectKind(entity)}:${entityId}` : null;
}

export type SyncOperation = 'create' | 'update' | 'delete' | 'action';

export type OutboxStatus = 'pending' | 'processing' | 'retry' | 'conflict' | 'completed';

export interface OutboxMutation<TPayload = unknown> {
  /** UUID sent to the API as client_mutation_id. */
  id: string;
  serverProfileId: string;
  databaseId: string;
  principalId?: string;
  entity: SyncEntity;
  entityId: string | null;
  operation: SyncOperation;
  payload: TPayload;
  baseUpdatedAt: string | null;
  createdAt: string;
  attempts: number;
  nextAttemptAt: string | null;
  dependsOn: string | null;
  status: OutboxStatus;
  lastError: string | null;
}

export type SyncConflictReason = 'modified' | 'deleted' | 'permission_changed';

export interface SyncConflict<TLocal = unknown, TServer = unknown> {
  mutationId: string;
  serverProfileId: string;
  databaseId: string;
  principalId?: string;
  entity: SyncEntity;
  entityId: string | null;
  local: TLocal;
  server: TServer;
  serverUpdatedAt: string;
  reason: SyncConflictReason;
  createdAt: string;
}

export interface ConflictResponseBody {
  success?: false;
  error?: string;
  code?: string;
  reason?: string;
  data?: {
    entity?: unknown;
    server_data?: unknown;
    server_updated_at?: string;
    reason?: string;
  };
  server_data?: unknown;
  server_updated_at?: string;
  conflict?: {
    entity?: SyncEntity;
    entity_id?: string | number | null;
    reason?: string;
    server?: unknown;
    server_updated_at?: string;
  };
}

export interface OutboxMutationResult {
  serverEntity?: unknown;
  serverUpdatedAt?: string;
}

export interface OutboxMutationExecutor {
  execute(mutation: OutboxMutation): Promise<OutboxMutationResult>;
}

export interface OutboxStore {
  enqueue(mutation: OutboxMutation): Promise<void>;
  getReady(serverProfileId: string, databaseId: string, now: string, principalId?: string): Promise<OutboxMutation[]>;
  applyResult?(mutation: OutboxMutation, result: OutboxMutationResult): Promise<void>;
  markProcessing(id: string): Promise<void>;
  markCompleted(id: string): Promise<void>;
  markRetry(id: string, attempts: number, nextAttemptAt: string, error: string): Promise<void>;
  markConflict(conflict: SyncConflict): Promise<void>;
}
