import {
  OutboxMutation,
  SyncEntity,
  SyncOperation,
} from '../domain/sync';
import * as Crypto from 'expo-crypto';

export interface NewOutboxMutation<TPayload> {
  serverProfileId: string;
  databaseId: string;
  principalId?: string;
  entity: SyncEntity;
  entityId: string | null;
  operation: SyncOperation;
  payload: TPayload;
  baseUpdatedAt?: string | null;
  dependsOn?: string | null;
}

function newMutationId(): string {
  return Crypto.randomUUID();
}

export function createOutboxMutation<TPayload>(
  input: NewOutboxMutation<TPayload>,
  options: { id?: string; now?: Date } = {},
): OutboxMutation<TPayload> {
  return {
    id: options.id ?? newMutationId(),
    serverProfileId: input.serverProfileId,
    databaseId: input.databaseId,
    ...(input.principalId ? { principalId: input.principalId } : {}),
    entity: input.entity,
    entityId: input.entityId,
    operation: input.operation,
    payload: input.payload,
    baseUpdatedAt: input.baseUpdatedAt ?? null,
    createdAt: (options.now ?? new Date()).toISOString(),
    attempts: 0,
    nextAttemptAt: null,
    dependsOn: input.dependsOn ?? null,
    status: 'pending',
    lastError: null,
  };
}
