import type { SQLiteDatabase } from 'expo-sqlite';

import type { Bill, DatabaseInfo, Payment } from '../types';
import { getMobileDatabase } from './database';
import {
  withSerializedMobileTransaction,
  withSerializedMobileWrite,
} from './databaseWriteQueue';

export interface CacheScope {
  serverProfileId: string;
  databaseId: string;
}

export interface MobileSyncSnapshot {
  bills: Bill[];
  payments: Payment[];
  groups?: DatabaseInfo[];
}

export interface MobileSyncSnapshotCommitResult {
  hadUnresolvedMutations: boolean;
}

export interface ReminderState {
  billId: string;
  notificationIds: string[];
  nextScheduledAt: string | null;
  snoozedUntil: string | null;
  dismissedDueDate: string | null;
  updatedAt: string;
}

interface EntityRow {
  payload_json: string;
}

async function replaceGroupsInTransaction(
  database: SQLiteDatabase,
  serverProfileId: string,
  groups: DatabaseInfo[],
  cachedAt: string,
): Promise<void> {
  await database.runAsync(
    'DELETE FROM bill_groups WHERE server_profile_id = ?',
    serverProfileId,
  );
  for (const group of groups) {
    await database.runAsync(
      `INSERT INTO bill_groups (
         server_profile_id, database_id, name, display_name, payload_json, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      serverProfileId,
      String(group.id),
      group.name,
      group.display_name,
      JSON.stringify(group),
      cachedAt,
    );
  }
}

async function markScopeCleanInTransaction(
  database: SQLiteDatabase,
  scope: CacheScope,
): Promise<void> {
  await database.runAsync(
    'UPDATE bills SET is_dirty = 0 WHERE server_profile_id = ? AND database_id = ?',
    scope.serverProfileId,
    scope.databaseId,
  );
  await database.runAsync(
    'UPDATE payments SET is_dirty = 0 WHERE server_profile_id = ? AND database_id = ?',
    scope.serverProfileId,
    scope.databaseId,
  );
}

async function replaceBillsInTransaction(
  database: SQLiteDatabase,
  scope: CacheScope,
  bills: Bill[],
  cachedAt: string,
): Promise<void> {
  await database.runAsync(
    `DELETE FROM bills
     WHERE server_profile_id = ? AND database_id = ? AND is_dirty = 0`,
    scope.serverProfileId,
    scope.databaseId,
  );
  for (const bill of bills) {
    await database.runAsync(
      `INSERT INTO bills (
         server_profile_id, database_id, entity_id, payload_json,
         server_updated_at, cached_at, is_dirty, is_archived
       ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(server_profile_id, database_id, entity_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         server_updated_at = excluded.server_updated_at,
         cached_at = excluded.cached_at,
         is_archived = excluded.is_archived
       WHERE bills.is_dirty = 0`,
      scope.serverProfileId,
      scope.databaseId,
      String(bill.id),
      JSON.stringify(bill),
      bill.last_updated ?? null,
      cachedAt,
      bill.archived ? 1 : 0,
    );
  }
}

async function replacePaymentsInTransaction(
  database: SQLiteDatabase,
  scope: CacheScope,
  payments: Payment[],
  cachedAt: string,
): Promise<void> {
  await database.runAsync(
    `DELETE FROM payments
     WHERE server_profile_id = ? AND database_id = ? AND is_dirty = 0`,
    scope.serverProfileId,
    scope.databaseId,
  );
  for (const payment of payments) {
    await database.runAsync(
      `INSERT INTO payments (
         server_profile_id, database_id, entity_id, bill_id, payload_json,
         server_updated_at, cached_at, is_dirty, is_deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)
       ON CONFLICT(server_profile_id, database_id, entity_id) DO UPDATE SET
         bill_id = excluded.bill_id,
         payload_json = excluded.payload_json,
         server_updated_at = excluded.server_updated_at,
         cached_at = excluded.cached_at,
         is_deleted = 0
       WHERE payments.is_dirty = 0`,
      scope.serverProfileId,
      scope.databaseId,
      String(payment.id),
      String(payment.bill_id),
      JSON.stringify(payment),
      payment.updated_at ?? null,
      cachedAt,
    );
  }
}

async function commitIdleSyncStateInTransaction(
  database: SQLiteDatabase,
  scope: CacheScope,
  synchronizedAt: string,
): Promise<void> {
  await database.runAsync(
    `INSERT INTO sync_state (
       server_profile_id, database_id, cursor, last_synced_at, status, last_error
     ) VALUES (?, ?, NULL, ?, 'idle', NULL)
     ON CONFLICT(server_profile_id, database_id) DO UPDATE SET
       cursor = NULL,
       last_synced_at = excluded.last_synced_at,
       status = 'idle',
       last_error = NULL`,
    scope.serverProfileId,
    scope.databaseId,
    synchronizedAt,
  );
}

export class MobileCacheRepository {
  constructor(private readonly databaseProvider = getMobileDatabase) {}

  async replaceGroups(serverProfileId: string, groups: DatabaseInfo[]): Promise<void> {
    const database = await this.databaseProvider();
    const now = new Date().toISOString();
    await withSerializedMobileTransaction(database, async () => {
      await replaceGroupsInTransaction(database, serverProfileId, groups, now);
    });
  }

  async getGroups(serverProfileId: string): Promise<DatabaseInfo[]> {
    const database = await this.databaseProvider();
    const rows = await database.getAllAsync<EntityRow>(
      `SELECT payload_json FROM bill_groups
       WHERE server_profile_id = ? ORDER BY display_name COLLATE NOCASE`,
      serverProfileId,
    );
    return rows.map((row) => JSON.parse(row.payload_json) as DatabaseInfo);
  }

  async upsertBills(
    scope: CacheScope,
    bills: Bill[],
    options: { dirty?: boolean } = {},
  ): Promise<void> {
    const database = await this.databaseProvider();
    const now = new Date().toISOString();
    await withSerializedMobileTransaction(database, async () => {
      for (const bill of bills) {
        await database.runAsync(
          `INSERT INTO bills (
             server_profile_id, database_id, entity_id, payload_json,
             server_updated_at, cached_at, is_dirty, is_archived
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(server_profile_id, database_id, entity_id) DO UPDATE SET
             payload_json = excluded.payload_json,
             server_updated_at = excluded.server_updated_at,
             cached_at = excluded.cached_at,
             is_dirty = excluded.is_dirty,
             is_archived = excluded.is_archived`,
          scope.serverProfileId,
          scope.databaseId,
          String(bill.id),
          JSON.stringify(bill),
          bill.last_updated ?? null,
          now,
          options.dirty ? 1 : 0,
          bill.archived ? 1 : 0,
        );
      }
    });
  }

  async replaceBills(scope: CacheScope, bills: Bill[]): Promise<void> {
    const database = await this.databaseProvider();
    const now = new Date().toISOString();
    await withSerializedMobileTransaction(database, async () => {
      await replaceBillsInTransaction(database, scope, bills, now);
    });
  }

  async getBills(scope: CacheScope, includeArchived = false): Promise<Bill[]> {
    const database = await this.databaseProvider();
    const rows = await database.getAllAsync<EntityRow>(
      `SELECT payload_json FROM bills
       WHERE server_profile_id = ? AND database_id = ?
         AND (? = 1 OR is_archived = 0)
       ORDER BY json_extract(payload_json, '$.next_due'), entity_id`,
      scope.serverProfileId,
      scope.databaseId,
      includeArchived ? 1 : 0,
    );
    return rows.map((row) => JSON.parse(row.payload_json) as Bill);
  }

  async upsertPayments(
    scope: CacheScope,
    payments: Payment[],
    options: { dirty?: boolean; deletedIds?: string[] } = {},
  ): Promise<void> {
    const database = await this.databaseProvider();
    const now = new Date().toISOString();
    const deletedIds = new Set(options.deletedIds ?? []);
    await withSerializedMobileTransaction(database, async () => {
      for (const payment of payments) {
        await database.runAsync(
          `INSERT INTO payments (
             server_profile_id, database_id, entity_id, bill_id, payload_json,
             server_updated_at, cached_at, is_dirty, is_deleted
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(server_profile_id, database_id, entity_id) DO UPDATE SET
             bill_id = excluded.bill_id,
             payload_json = excluded.payload_json,
             server_updated_at = excluded.server_updated_at,
             cached_at = excluded.cached_at,
             is_dirty = excluded.is_dirty,
             is_deleted = excluded.is_deleted`,
          scope.serverProfileId,
          scope.databaseId,
          String(payment.id),
          String(payment.bill_id),
          JSON.stringify(payment),
          payment.updated_at ?? null,
          now,
          options.dirty ? 1 : 0,
          deletedIds.has(String(payment.id)) ? 1 : 0,
        );
      }
    });
  }

  async replacePayments(scope: CacheScope, payments: Payment[]): Promise<void> {
    const database = await this.databaseProvider();
    const now = new Date().toISOString();
    await withSerializedMobileTransaction(database, async () => {
      await replacePaymentsInTransaction(database, scope, payments, now);
    });
  }

  async markScopeClean(scope: CacheScope): Promise<void> {
    const database = await this.databaseProvider();
    await withSerializedMobileTransaction(database, async () => {
      await markScopeCleanInTransaction(database, scope);
    });
  }

  async commitSyncSnapshot(
    scope: CacheScope,
    snapshot: MobileSyncSnapshot,
    synchronizedAt: string,
  ): Promise<MobileSyncSnapshotCommitResult> {
    const database = await this.databaseProvider();
    return withSerializedMobileTransaction(database, async () => {
      const unresolved = await database.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM outbox
         WHERE server_profile_id = ? AND database_id = ?
           AND status IN ('pending', 'processing', 'retry', 'conflict')`,
        scope.serverProfileId,
        scope.databaseId,
      );
      const hadUnresolvedMutations = Number(unresolved?.count ?? 0) > 0;

      if (!hadUnresolvedMutations) {
        await markScopeCleanInTransaction(database, scope);
      }
      await replaceBillsInTransaction(database, scope, snapshot.bills, synchronizedAt);
      await replacePaymentsInTransaction(database, scope, snapshot.payments, synchronizedAt);
      if (snapshot.groups !== undefined) {
        await replaceGroupsInTransaction(
          database,
          scope.serverProfileId,
          snapshot.groups,
          synchronizedAt,
        );
      }
      await commitIdleSyncStateInTransaction(database, scope, synchronizedAt);

      return { hadUnresolvedMutations };
    });
  }

  async markEntityClean(
    scope: CacheScope,
    entity: 'bill' | 'payment',
    entityId: string,
  ): Promise<void> {
    const database = await this.databaseProvider();
    const table = entity === 'bill' ? 'bills' : 'payments';
    await withSerializedMobileWrite(database, async () => {
      await database.runAsync(
        `UPDATE ${table} SET is_dirty = 0
         WHERE server_profile_id = ? AND database_id = ? AND entity_id = ?`,
        scope.serverProfileId,
        scope.databaseId,
        entityId,
      );
    });
  }

  async getPayments(scope: CacheScope, billId?: string): Promise<Payment[]> {
    const database = await this.databaseProvider();
    const rows = billId
      ? await database.getAllAsync<EntityRow>(
          `SELECT payload_json FROM payments
           WHERE server_profile_id = ? AND database_id = ? AND bill_id = ? AND is_deleted = 0
           ORDER BY json_extract(payload_json, '$.payment_date') DESC`,
          scope.serverProfileId,
          scope.databaseId,
          billId,
        )
      : await database.getAllAsync<EntityRow>(
          `SELECT payload_json FROM payments
           WHERE server_profile_id = ? AND database_id = ? AND is_deleted = 0
           ORDER BY json_extract(payload_json, '$.payment_date') DESC`,
          scope.serverProfileId,
          scope.databaseId,
        );
    return rows.map((row) => JSON.parse(row.payload_json) as Payment);
  }

  async putAnalyticsSnapshot(
    scope: CacheScope,
    key: string,
    payload: unknown,
    expiresAt: string | null,
  ): Promise<void> {
    const database = await this.databaseProvider();
    await withSerializedMobileWrite(database, async () => {
      await database.runAsync(
        `INSERT INTO analytics_snapshots (
           server_profile_id, database_id, snapshot_key, payload_json, expires_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_profile_id, database_id, snapshot_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
        scope.serverProfileId,
        scope.databaseId,
        key,
        JSON.stringify(payload),
        expiresAt,
        new Date().toISOString(),
      );
    });
  }

  async putReminderState(scope: CacheScope, state: ReminderState): Promise<void> {
    const database = await this.databaseProvider();
    await withSerializedMobileWrite(database, async () => {
      await database.runAsync(
        `INSERT INTO reminder_state (
           server_profile_id, database_id, bill_id, notification_ids_json,
           next_scheduled_at, snoozed_until, dismissed_due_date, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_profile_id, database_id, bill_id) DO UPDATE SET
           notification_ids_json = excluded.notification_ids_json,
           next_scheduled_at = excluded.next_scheduled_at,
           snoozed_until = excluded.snoozed_until,
           dismissed_due_date = excluded.dismissed_due_date,
           updated_at = excluded.updated_at`,
        scope.serverProfileId,
        scope.databaseId,
        state.billId,
        JSON.stringify(state.notificationIds),
        state.nextScheduledAt,
        state.snoozedUntil,
        state.dismissedDueDate,
        state.updatedAt,
      );
    });
  }

  async getReminderStates(scope: CacheScope): Promise<ReminderState[]> {
    const database = await this.databaseProvider();
    const rows = await database.getAllAsync<{
      bill_id: string;
      notification_ids_json: string;
      next_scheduled_at: string | null;
      snoozed_until: string | null;
      dismissed_due_date: string | null;
      updated_at: string;
    }>(
      `SELECT bill_id, notification_ids_json, next_scheduled_at, snoozed_until, dismissed_due_date, updated_at
       FROM reminder_state WHERE server_profile_id = ? AND database_id = ?`,
      scope.serverProfileId,
      scope.databaseId,
    );
    return rows.map((row) => ({
      billId: row.bill_id,
      notificationIds: JSON.parse(row.notification_ids_json) as string[],
      nextScheduledAt: row.next_scheduled_at,
      snoozedUntil: row.snoozed_until,
      dismissedDueDate: row.dismissed_due_date,
      updatedAt: row.updated_at,
    }));
  }

  async getAnalyticsSnapshot<T>(scope: CacheScope, key: string): Promise<T | null> {
    const database = await this.databaseProvider();
    const row = await database.getFirstAsync<EntityRow>(
      `SELECT payload_json FROM analytics_snapshots
       WHERE server_profile_id = ? AND database_id = ? AND snapshot_key = ?
         AND (expires_at IS NULL OR expires_at > ?)`,
      scope.serverProfileId,
      scope.databaseId,
      key,
      new Date().toISOString(),
    );
    return row ? (JSON.parse(row.payload_json) as T) : null;
  }
}
