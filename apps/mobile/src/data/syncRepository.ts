import {
  OutboxMutation,
  OutboxStore,
  SyncConflict,
  SyncEntity,
  SyncOperation,
  OutboxStatus,
  OutboxMutationResult,
  syncObjectKind,
} from '../domain/sync';
import { getMobileDatabase } from './database';
import {
  withSerializedMobileTransaction,
  withSerializedMobileWrite,
} from './databaseWriteQueue';

interface OutboxRow {
  id: string;
  server_profile_id: string;
  database_id: string;
  entity: SyncEntity;
  entity_id: string | null;
  operation: SyncOperation;
  payload_json: string;
  base_updated_at: string | null;
  created_at: string;
  attempts: number;
  next_attempt_at: string | null;
  depends_on: string | null;
  status: OutboxStatus;
  last_error: string | null;
}

function mutationFromRow(row: OutboxRow): OutboxMutation {
  return {
    id: row.id,
    serverProfileId: row.server_profile_id,
    databaseId: row.database_id,
    entity: row.entity,
    entityId: row.entity_id,
    operation: row.operation,
    payload: JSON.parse(row.payload_json) as unknown,
    baseUpdatedAt: row.base_updated_at,
    createdAt: row.created_at,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    dependsOn: row.depends_on,
    status: row.status,
    lastError: row.last_error,
  };
}

export interface SyncState {
  cursor: string | null;
  lastSyncedAt: string | null;
  status: 'idle' | 'syncing' | 'error';
  lastError: string | null;
}

export interface StoredMutationScope {
  serverProfileId: string;
  databaseId: string;
}

export class SQLiteSyncRepository implements OutboxStore {
  constructor(private readonly databaseProvider = getMobileDatabase) {}

  async enqueue(mutation: OutboxMutation): Promise<void> {
    const database = await this.databaseProvider();
    await withSerializedMobileWrite(database, async () => {
      await database.runAsync(
        `INSERT INTO outbox (
           id, server_profile_id, database_id, entity, entity_id, operation,
           payload_json, base_updated_at, created_at, attempts, next_attempt_at,
           depends_on, status, last_error
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        mutation.id,
        mutation.serverProfileId,
        mutation.databaseId,
        mutation.entity,
        mutation.entityId,
        mutation.operation,
        JSON.stringify(mutation.payload),
        mutation.baseUpdatedAt,
        mutation.createdAt,
        mutation.attempts,
        mutation.nextAttemptAt,
        mutation.dependsOn,
        mutation.status,
        mutation.lastError,
      );
    });
  }

  async getReady(
    serverProfileId: string,
    databaseId: string,
    now: string,
  ): Promise<OutboxMutation[]> {
    const database = await this.databaseProvider();
    // A process can be terminated after a mutation is claimed but before it is
    // completed. getReady is called only at the start of a serialized scope
    // run, so any processing row at this point belongs to an interrupted run.
    // Retrying with the same mutation id is safe because the server contract is
    // idempotent for client_mutation_id.
    return withSerializedMobileWrite(database, async () => {
      await database.runAsync(
        `UPDATE outbox
         SET status = 'retry', next_attempt_at = NULL,
             last_error = 'Recovered an interrupted synchronization attempt.'
         WHERE server_profile_id = ? AND database_id = ? AND status = 'processing'`,
        serverProfileId,
        databaseId,
      );
      const rows = await database.getAllAsync<OutboxRow>(
        `SELECT candidate.* FROM outbox candidate
         LEFT JOIN outbox dependency ON dependency.id = candidate.depends_on
         WHERE candidate.server_profile_id = ?
           AND candidate.database_id = ?
           AND candidate.status IN ('pending', 'retry')
           AND (candidate.next_attempt_at IS NULL OR candidate.next_attempt_at <= ?)
           AND (candidate.depends_on IS NULL OR dependency.status = 'completed')
         ORDER BY candidate.created_at, candidate.id`,
        serverProfileId,
        databaseId,
        now,
      );
      return rows.map(mutationFromRow);
    });
  }

  async applyResult(
    mutation: OutboxMutation,
    result: OutboxMutationResult,
  ): Promise<void> {
    const serverEntity = result.serverEntity;
    const serverRecord = serverEntity && typeof serverEntity === 'object'
      ? serverEntity as Record<string, unknown>
      : {};
    const database = await this.databaseProvider();

    if (
      mutation.operation !== 'create'
      || (mutation.entity !== 'bill' && mutation.entity !== 'payment')
    ) {
      const nextBaseUpdatedAt = result.serverUpdatedAt;
      if (!mutation.entityId || !nextBaseUpdatedAt) return;

      const isPayment = syncObjectKind(mutation.entity) === 'payment';
      const cacheTable = isPayment ? 'payments' : 'bills';
      const timestampField = isPayment ? 'updated_at' : 'last_updated';
      const entityTimestamp = typeof serverRecord[timestampField] === 'string'
        ? serverRecord[timestampField] as string
        : nextBaseUpdatedAt;
      const entityPredicate = isPayment
        ? "entity = 'payment'"
        : "entity IN ('bill', 'bill_archive', 'bill_restore', 'reminder_settings')";

      await withSerializedMobileTransaction(database, async () => {
        const cachedRow = await database.getFirstAsync<{ payload_json: string }>(
          `SELECT payload_json FROM ${cacheTable}
           WHERE server_profile_id = ? AND database_id = ? AND entity_id = ?`,
          mutation.serverProfileId,
          mutation.databaseId,
          mutation.entityId,
        );
        if (cachedRow) {
          const payload = JSON.parse(cachedRow.payload_json) as Record<string, unknown>;
          payload[timestampField] = entityTimestamp;
          await database.runAsync(
            `UPDATE ${cacheTable} SET payload_json = ?, server_updated_at = ?
             WHERE server_profile_id = ? AND database_id = ? AND entity_id = ?`,
            JSON.stringify(payload),
            entityTimestamp,
            mutation.serverProfileId,
            mutation.databaseId,
            mutation.entityId,
          );
        }

        await database.runAsync(
          `UPDATE outbox SET base_updated_at = ?
           WHERE server_profile_id = ? AND database_id = ?
             AND status IN ('pending', 'retry')
             AND (
               (
                 entity_id = ? AND ${entityPredicate}
                 AND id <> ?
                 AND (created_at > ? OR (created_at = ? AND id > ?))
               )
               OR depends_on = ?
             )`,
          nextBaseUpdatedAt,
          mutation.serverProfileId,
          mutation.databaseId,
          mutation.entityId,
          mutation.id,
          mutation.createdAt,
          mutation.createdAt,
          mutation.id,
          mutation.id,
        );
      });
      return;
    }

    if (!mutation.entityId || !('id' in serverRecord)) return;
    const serverId = Number(serverRecord.id);
    if (!Number.isInteger(serverId) || serverId <= 0) return;

    const temporaryId = mutation.entityId;
    await withSerializedMobileTransaction(database, async () => {
      if (mutation.entity === 'payment') {
        const paymentUpdatedAt = typeof serverRecord.updated_at === 'string'
          ? serverRecord.updated_at
          : result.serverUpdatedAt ?? null;
        const billUpdatedAt = typeof serverRecord.bill_last_updated === 'string'
          ? serverRecord.bill_last_updated
          : null;
        const mutationPayload = mutation.payload && typeof mutation.payload === 'object'
          ? mutation.payload as Record<string, unknown>
          : {};
        const affectedBillId = mutationPayload.bill_id === undefined
          ? null
          : String(mutationPayload.bill_id);
        const paymentRow = await database.getFirstAsync<{ payload_json: string }>(
          `SELECT payload_json FROM payments
           WHERE server_profile_id = ? AND database_id = ? AND entity_id = ?`,
          mutation.serverProfileId,
          mutation.databaseId,
          temporaryId,
        );
        if (paymentRow) {
          const payload = JSON.parse(paymentRow.payload_json) as Record<string, unknown>;
          payload.id = serverId;
          if (typeof serverRecord.updated_at === 'string') {
            payload.updated_at = serverRecord.updated_at;
          }
          await database.runAsync(
            `UPDATE payments SET entity_id = ?, payload_json = ?, server_updated_at = ?
             WHERE server_profile_id = ? AND database_id = ? AND entity_id = ?`,
            String(serverId),
            JSON.stringify(payload),
            paymentUpdatedAt,
            mutation.serverProfileId,
            mutation.databaseId,
            temporaryId,
          );
        }

        await database.runAsync(
          `UPDATE outbox SET entity_id = ?,
             base_updated_at = COALESCE(?, base_updated_at)
           WHERE server_profile_id = ? AND database_id = ?
             AND entity = 'payment' AND entity_id = ?
             AND operation IN ('update', 'delete')
             AND status IN ('pending', 'retry')`,
          String(serverId),
          paymentUpdatedAt,
          mutation.serverProfileId,
          mutation.databaseId,
          temporaryId,
        );

        if (affectedBillId && billUpdatedAt) {
          const billRow = await database.getFirstAsync<{ payload_json: string }>(
            `SELECT payload_json FROM bills
             WHERE server_profile_id = ? AND database_id = ? AND entity_id = ?`,
            mutation.serverProfileId,
            mutation.databaseId,
            affectedBillId,
          );
          if (billRow) {
            const payload = JSON.parse(billRow.payload_json) as Record<string, unknown>;
            payload.last_updated = billUpdatedAt;
            await database.runAsync(
              `UPDATE bills SET payload_json = ?, server_updated_at = ?
               WHERE server_profile_id = ? AND database_id = ? AND entity_id = ?`,
              JSON.stringify(payload),
              billUpdatedAt,
              mutation.serverProfileId,
              mutation.databaseId,
              affectedBillId,
            );
          }
          await database.runAsync(
            `UPDATE outbox SET base_updated_at = ?
             WHERE depends_on = ? AND status IN ('pending', 'retry')
               AND NOT (
                 entity = 'payment' AND entity_id = ?
                 AND operation IN ('update', 'delete')
               )`,
            billUpdatedAt,
            mutation.id,
            temporaryId,
          );
        }
        return;
      }

      const billUpdatedAt = typeof serverRecord.last_updated === 'string'
        ? serverRecord.last_updated
        : result.serverUpdatedAt ?? null;
      const billRow = await database.getFirstAsync<{ payload_json: string }>(
        `SELECT payload_json FROM bills
         WHERE server_profile_id = ? AND database_id = ? AND entity_id = ?`,
        mutation.serverProfileId,
        mutation.databaseId,
        temporaryId,
      );
      if (billRow) {
        const payload = JSON.parse(billRow.payload_json) as Record<string, unknown>;
        payload.id = serverId;
        if (typeof serverRecord.last_updated === 'string') {
          payload.last_updated = serverRecord.last_updated;
        }
        await database.runAsync(
          `UPDATE bills SET entity_id = ?, payload_json = ?, server_updated_at = ?
           WHERE server_profile_id = ? AND database_id = ? AND entity_id = ?`,
          String(serverId),
          JSON.stringify(payload),
          result.serverUpdatedAt ?? billUpdatedAt,
          mutation.serverProfileId,
          mutation.databaseId,
          temporaryId,
        );
      }

      const dependentRows = await database.getAllAsync<{ id: string; payload_json: string }>(
        `SELECT id, payload_json FROM outbox
         WHERE server_profile_id = ? AND database_id = ?
           AND status IN ('pending', 'retry')`,
        mutation.serverProfileId,
        mutation.databaseId,
      );
      for (const row of dependentRows) {
        const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
        if (String(payload.bill_id ?? '') !== temporaryId) continue;
        payload.bill_id = serverId;
        await database.runAsync(
          `UPDATE outbox SET payload_json = ?,
             base_updated_at = COALESCE(?, base_updated_at) WHERE id = ?`,
          JSON.stringify(payload),
          billUpdatedAt,
          row.id,
        );
      }
      await database.runAsync(
        `UPDATE outbox SET entity_id = ?,
           base_updated_at = COALESCE(?, base_updated_at)
         WHERE server_profile_id = ? AND database_id = ?
           AND entity IN ('bill', 'bill_archive', 'bill_restore', 'reminder_settings')
           AND entity_id = ?
           AND status IN ('pending', 'retry')`,
        String(serverId),
        billUpdatedAt,
        mutation.serverProfileId,
        mutation.databaseId,
        temporaryId,
      );

      const paymentRows = await database.getAllAsync<{
        entity_id: string;
        payload_json: string;
      }>(
        `SELECT entity_id, payload_json FROM payments
         WHERE server_profile_id = ? AND database_id = ? AND bill_id = ?`,
        mutation.serverProfileId,
        mutation.databaseId,
        temporaryId,
      );
      for (const row of paymentRows) {
        const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
        payload.bill_id = serverId;
        await database.runAsync(
          `UPDATE payments SET bill_id = ?, payload_json = ?
           WHERE server_profile_id = ? AND database_id = ? AND entity_id = ?`,
          String(serverId),
          JSON.stringify(payload),
          mutation.serverProfileId,
          mutation.databaseId,
          row.entity_id,
        );
      }
    });
  }

  async findPendingCreate(
    serverProfileId: string,
    databaseId: string,
    entity: SyncEntity,
    entityId: string,
  ): Promise<string | null> {
    const database = await this.databaseProvider();
    const row = await database.getFirstAsync<{ id: string }>(
      `SELECT id FROM outbox
       WHERE server_profile_id = ? AND database_id = ? AND entity = ?
         AND entity_id = ? AND operation = 'create'
         AND status IN ('pending', 'processing', 'retry')
       ORDER BY created_at DESC LIMIT 1`,
      serverProfileId,
      databaseId,
      entity,
      entityId,
    );
    return row?.id ?? null;
  }

  async findLatestPendingForEntity(
    serverProfileId: string,
    databaseId: string,
    entity: SyncEntity,
    entityId: string,
  ): Promise<string | null> {
    const database = await this.databaseProvider();
    const entityPredicate = syncObjectKind(entity) === 'payment'
      ? "entity = 'payment'"
      : "entity IN ('bill', 'bill_archive', 'bill_restore', 'reminder_settings')";
    const row = await database.getFirstAsync<{ id: string }>(
      `SELECT id FROM outbox
       WHERE server_profile_id = ? AND database_id = ? AND entity_id = ?
         AND ${entityPredicate}
         AND status IN ('pending', 'processing', 'retry', 'conflict')
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      serverProfileId,
      databaseId,
      entityId,
    );
    return row?.id ?? null;
  }

  async findLatestPendingForBill(
    serverProfileId: string,
    databaseId: string,
    billId: string,
  ): Promise<string | null> {
    const database = await this.databaseProvider();
    const rows = await database.getAllAsync<Pick<OutboxRow,
      'id' | 'entity' | 'entity_id' | 'operation' | 'payload_json'
    >>(
      `SELECT id, entity, entity_id, operation, payload_json FROM outbox
       WHERE server_profile_id = ? AND database_id = ?
         AND status IN ('pending', 'processing', 'retry', 'conflict')
       ORDER BY created_at DESC, id DESC`,
      serverProfileId,
      databaseId,
    );
    for (const row of rows) {
      if (syncObjectKind(row.entity) === 'bill' && row.entity_id === billId) {
        return row.id;
      }
      if (row.entity !== 'payment' || row.operation !== 'create') continue;
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      if (String(payload.bill_id ?? '') === billId) return row.id;
    }
    return null;
  }

  async markProcessing(id: string): Promise<void> {
    await this.updateStatus(id, 'processing', null, null, null);
  }

  async markCompleted(id: string): Promise<void> {
    await this.updateStatus(id, 'completed', null, null, null);
  }

  async markRetry(
    id: string,
    attempts: number,
    nextAttemptAt: string,
    error: string,
  ): Promise<void> {
    await this.updateStatus(id, 'retry', attempts, nextAttemptAt, error);
  }

  async markConflict(conflict: SyncConflict): Promise<void> {
    const database = await this.databaseProvider();
    await withSerializedMobileTransaction(database, async () => {
      let local = conflict.local;
      if (conflict.reason === 'deleted' && conflict.entityId) {
        const cacheTable = conflict.entity === 'payment' ? 'payments' : 'bills';
        const cached = await database.getFirstAsync<{ payload_json: string }>(
          `SELECT payload_json FROM ${cacheTable}
           WHERE server_profile_id = ? AND database_id = ? AND entity_id = ?`,
          conflict.serverProfileId,
          conflict.databaseId,
          conflict.entityId,
        );
        if (cached?.payload_json) {
          local = JSON.parse(cached.payload_json) as unknown;
        }
      }
      await database.runAsync(
        `INSERT INTO conflicts (
           mutation_id, server_profile_id, database_id, entity, entity_id,
           local_json, server_json, server_updated_at, reason, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(mutation_id) DO UPDATE SET
           local_json = excluded.local_json,
           server_json = excluded.server_json,
           server_updated_at = excluded.server_updated_at,
           reason = excluded.reason`,
        conflict.mutationId,
        conflict.serverProfileId,
        conflict.databaseId,
        conflict.entity,
        conflict.entityId,
        JSON.stringify(local),
        JSON.stringify(conflict.server),
        conflict.serverUpdatedAt,
        conflict.reason,
        conflict.createdAt,
      );
      await database.runAsync(
        `UPDATE outbox SET status = 'conflict', last_error = ?, next_attempt_at = NULL
         WHERE id = ?`,
        conflict.reason,
        conflict.mutationId,
      );
    });
  }

  async getConflicts(serverProfileId: string, databaseId: string): Promise<SyncConflict[]> {
    const database = await this.databaseProvider();
    const rows = await database.getAllAsync<{
      mutation_id: string;
      server_profile_id: string;
      database_id: string;
      entity: SyncEntity;
      entity_id: string | null;
      local_json: string;
      server_json: string;
      server_updated_at: string;
      reason: SyncConflict['reason'];
      created_at: string;
    }>(
      `SELECT * FROM conflicts WHERE server_profile_id = ? AND database_id = ?
       ORDER BY created_at`,
      serverProfileId,
      databaseId,
    );
    return rows.map((row) => ({
      mutationId: row.mutation_id,
      serverProfileId: row.server_profile_id,
      databaseId: row.database_id,
      entity: row.entity,
      entityId: row.entity_id,
      local: JSON.parse(row.local_json) as unknown,
      server: JSON.parse(row.server_json) as unknown,
      serverUpdatedAt: row.server_updated_at,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  async resolveConflict(
    mutationId: string,
    strategy: 'use_server' | 'keep_local',
  ): Promise<SyncConflict | null> {
    const database = await this.databaseProvider();
    const conflict = await this.getConflict(mutationId);
    if (!conflict) return null;
    await withSerializedMobileTransaction(database, async () => {
      if (strategy === 'use_server') {
        await database.runAsync(
          `UPDATE outbox SET status = 'completed', last_error = NULL WHERE id = ?`,
          mutationId,
        );
        await database.runAsync(
          `UPDATE outbox SET base_updated_at = ?
           WHERE depends_on = ? AND status IN ('pending', 'retry')`,
          conflict.serverUpdatedAt,
          mutationId,
        );
      } else {
        const mutation = await database.getFirstAsync<{
          entity: SyncEntity;
          operation: string;
        }>('SELECT entity, operation FROM outbox WHERE id = ?', mutationId);
        const deletionAlreadySatisfied = conflict.reason === 'deleted' && (
          (mutation?.entity === 'payment' && mutation.operation === 'delete')
          || mutation?.entity === 'bill_archive'
        );
        if (deletionAlreadySatisfied) {
          await database.runAsync(
            `UPDATE outbox SET status = 'completed', last_error = NULL,
               next_attempt_at = NULL WHERE id = ?`,
            mutationId,
          );
          const cacheTable = mutation?.entity === 'payment' ? 'payments' : 'bills';
          if (conflict.entityId) {
            await database.runAsync(
              `UPDATE ${cacheTable} SET is_dirty = 0
               WHERE server_profile_id = ? AND database_id = ? AND entity_id = ?`,
              conflict.serverProfileId,
              conflict.databaseId,
              conflict.entityId,
            );
          }
        } else if (conflict.reason === 'deleted' && mutation) {
          const recreatableEntity = mutation.entity === 'payment' ? 'payment' : 'bill';
          await database.runAsync(
            `UPDATE outbox
             SET entity = ?, operation = 'create', payload_json = ?,
                 base_updated_at = NULL, status = 'pending', attempts = 0,
                 next_attempt_at = NULL, last_error = NULL
             WHERE id = ?`,
            recreatableEntity,
            JSON.stringify(conflict.local),
            mutationId,
          );
        } else {
          await database.runAsync(
            `UPDATE outbox
             SET status = 'pending', base_updated_at = ?, attempts = 0,
                 next_attempt_at = NULL, last_error = NULL
             WHERE id = ?`,
            conflict.serverUpdatedAt,
            mutationId,
          );
        }
      }
      await database.runAsync('DELETE FROM conflicts WHERE mutation_id = ?', mutationId);
    });
    return conflict;
  }

  async getConflict(mutationId: string): Promise<SyncConflict | null> {
    const database = await this.databaseProvider();
    const row = await database.getFirstAsync<{
      mutation_id: string;
      server_profile_id: string;
      database_id: string;
      entity: SyncEntity;
      entity_id: string | null;
      local_json: string;
      server_json: string;
      server_updated_at: string;
      reason: SyncConflict['reason'];
      created_at: string;
    }>('SELECT * FROM conflicts WHERE mutation_id = ?', mutationId);
    return row
      ? {
          mutationId: row.mutation_id,
          serverProfileId: row.server_profile_id,
          databaseId: row.database_id,
          entity: row.entity,
          entityId: row.entity_id,
          local: JSON.parse(row.local_json) as unknown,
          server: JSON.parse(row.server_json) as unknown,
          serverUpdatedAt: row.server_updated_at,
          reason: row.reason,
          createdAt: row.created_at,
        }
      : null;
  }

  async hasUnresolvedMutations(serverProfileId: string, databaseId: string): Promise<boolean> {
    const database = await this.databaseProvider();
    const row = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM outbox
       WHERE server_profile_id = ? AND database_id = ?
         AND status IN ('pending', 'processing', 'retry', 'conflict')`,
      serverProfileId,
      databaseId,
    );
    return (row?.count ?? 0) > 0;
  }

  async listMutationScopes(): Promise<StoredMutationScope[]> {
    const database = await this.databaseProvider();
    const rows = await database.getAllAsync<{
      server_profile_id: string;
      database_id: string;
    }>(
      `SELECT DISTINCT server_profile_id, database_id
       FROM outbox
       WHERE status IN ('pending', 'processing', 'retry', 'conflict')
       ORDER BY server_profile_id, database_id`,
    );
    return rows.map((row) => ({
      serverProfileId: row.server_profile_id,
      databaseId: row.database_id,
    }));
  }

  async pruneCompleted(before: string): Promise<void> {
    const database = await this.databaseProvider();
    await withSerializedMobileWrite(database, async () => {
      await database.runAsync(
        `DELETE FROM outbox WHERE status = 'completed' AND created_at < ?`,
        before,
      );
    });
  }

  async getSyncState(serverProfileId: string, databaseId: string): Promise<SyncState | null> {
    const database = await this.databaseProvider();
    const row = await database.getFirstAsync<{
      cursor: string | null;
      last_synced_at: string | null;
      status: SyncState['status'];
      last_error: string | null;
    }>(
      'SELECT cursor, last_synced_at, status, last_error FROM sync_state WHERE server_profile_id = ? AND database_id = ?',
      serverProfileId,
      databaseId,
    );
    return row
      ? {
          cursor: row.cursor,
          lastSyncedAt: row.last_synced_at,
          status: row.status,
          lastError: row.last_error,
        }
      : null;
  }

  async setSyncState(
    serverProfileId: string,
    databaseId: string,
    state: SyncState,
  ): Promise<void> {
    const database = await this.databaseProvider();
    await withSerializedMobileWrite(database, async () => {
      await database.runAsync(
        `INSERT INTO sync_state (
           server_profile_id, database_id, cursor, last_synced_at, status, last_error
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_profile_id, database_id) DO UPDATE SET
           cursor = excluded.cursor,
           last_synced_at = excluded.last_synced_at,
           status = excluded.status,
           last_error = excluded.last_error`,
        serverProfileId,
        databaseId,
        state.cursor,
        state.lastSyncedAt,
        state.status,
        state.lastError,
      );
    });
  }

  private async updateStatus(
    id: string,
    status: OutboxStatus,
    attempts: number | null,
    nextAttemptAt: string | null,
    error: string | null,
  ): Promise<void> {
    const database = await this.databaseProvider();
    await withSerializedMobileWrite(database, async () => {
      await database.runAsync(
        `UPDATE outbox SET
           status = ?,
           attempts = COALESCE(?, attempts),
           next_attempt_at = ?,
           last_error = ?
         WHERE id = ?`,
        status,
        attempts,
        nextAttemptAt,
        error,
        id,
      );
    });
  }
}
