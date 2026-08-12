import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-crypto', () => ({ getRandomBytesAsync: vi.fn() }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

import type { Bill, DatabaseInfo, Payment } from '../types';
import { MobileCacheRepository } from './cacheRepository';

type OutboxStatus = 'pending' | 'processing' | 'retry' | 'conflict' | 'completed';

interface StoredBill {
  serverProfileId: string;
  databaseId: string;
  entityId: string;
  payload: Record<string, unknown>;
  serverUpdatedAt: string | null;
  cachedAt: string;
  dirty: boolean;
  archived: boolean;
}

interface StoredPayment {
  serverProfileId: string;
  databaseId: string;
  entityId: string;
  billId: string;
  payload: Record<string, unknown>;
  serverUpdatedAt: string | null;
  cachedAt: string;
  dirty: boolean;
  deleted: boolean;
}

interface StoredGroup {
  serverProfileId: string;
  databaseId: string;
  payload: Record<string, unknown>;
  updatedAt: string;
}

interface StoredSyncState {
  serverProfileId: string;
  databaseId: string;
  cursor: string | null;
  lastSyncedAt: string | null;
  status: 'idle' | 'syncing' | 'error';
  lastError: string | null;
}

interface SnapshotDatabaseState {
  bills: StoredBill[];
  payments: StoredPayment[];
  groups: StoredGroup[];
  outbox: Array<{
    serverProfileId: string;
    databaseId: string;
    status: OutboxStatus;
  }>;
  syncStates: StoredSyncState[];
}

function cloneState(state: SnapshotDatabaseState): SnapshotDatabaseState {
  return JSON.parse(JSON.stringify(state)) as SnapshotDatabaseState;
}

function normalized(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

class StatefulSnapshotDatabase {
  transactionCount = 0;
  commitCount = 0;
  rollbackCount = 0;
  failOnPaymentInsert = false;
  readonly statements: string[] = [];

  constructor(public state: SnapshotDatabaseState) {}

  async withTransactionAsync(callback: () => Promise<void>): Promise<void> {
    this.transactionCount += 1;
    const before = cloneState(this.state);
    try {
      await callback();
      this.commitCount += 1;
    } catch (error) {
      this.state = before;
      this.rollbackCount += 1;
      throw error;
    }
  }

  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    const query = normalized(sql);
    if (!query.startsWith('SELECT COUNT(*) AS count FROM outbox')) {
      throw new Error(`Unexpected getFirstAsync query: ${query}`);
    }
    const [serverProfileId, databaseId] = params as string[];
    const unresolvedStatuses = new Set<OutboxStatus>([
      'pending',
      'processing',
      'retry',
      'conflict',
    ]);
    const count = this.state.outbox.filter((row) => (
      row.serverProfileId === serverProfileId
      && row.databaseId === databaseId
      && unresolvedStatuses.has(row.status)
    )).length;
    return { count } as T;
  }

  async runAsync(sql: string, ...params: unknown[]): Promise<void> {
    const query = normalized(sql);
    this.statements.push(query);

    if (query.startsWith('UPDATE bills SET is_dirty = 0')) {
      const [serverProfileId, databaseId] = params as string[];
      for (const bill of this.state.bills) {
        if (bill.serverProfileId === serverProfileId && bill.databaseId === databaseId) {
          bill.dirty = false;
        }
      }
      return;
    }

    if (query.startsWith('UPDATE payments SET is_dirty = 0')) {
      const [serverProfileId, databaseId] = params as string[];
      for (const payment of this.state.payments) {
        if (payment.serverProfileId === serverProfileId && payment.databaseId === databaseId) {
          payment.dirty = false;
        }
      }
      return;
    }

    if (query.startsWith('DELETE FROM bills')) {
      const [serverProfileId, databaseId] = params as string[];
      this.state.bills = this.state.bills.filter((bill) => !(
        bill.serverProfileId === serverProfileId
        && bill.databaseId === databaseId
        && !bill.dirty
      ));
      return;
    }

    if (query.startsWith('INSERT INTO bills')) {
      const [
        serverProfileId,
        databaseId,
        entityId,
        payloadJson,
        serverUpdatedAt,
        cachedAt,
        archived,
      ] = params as [string, string, string, string, string | null, string, number];
      const existing = this.state.bills.find((bill) => (
        bill.serverProfileId === serverProfileId
        && bill.databaseId === databaseId
        && bill.entityId === entityId
      ));
      if (existing?.dirty) return;
      const replacement: StoredBill = {
        serverProfileId,
        databaseId,
        entityId,
        payload: JSON.parse(payloadJson) as Record<string, unknown>,
        serverUpdatedAt,
        cachedAt,
        dirty: false,
        archived: archived === 1,
      };
      if (existing) Object.assign(existing, replacement);
      else this.state.bills.push(replacement);
      return;
    }

    if (query.startsWith('DELETE FROM payments')) {
      const [serverProfileId, databaseId] = params as string[];
      this.state.payments = this.state.payments.filter((payment) => !(
        payment.serverProfileId === serverProfileId
        && payment.databaseId === databaseId
        && !payment.dirty
      ));
      return;
    }

    if (query.startsWith('INSERT INTO payments')) {
      if (this.failOnPaymentInsert) throw new Error('forced payment snapshot failure');
      const [
        serverProfileId,
        databaseId,
        entityId,
        billId,
        payloadJson,
        serverUpdatedAt,
        cachedAt,
      ] = params as [string, string, string, string, string, string | null, string];
      const existing = this.state.payments.find((payment) => (
        payment.serverProfileId === serverProfileId
        && payment.databaseId === databaseId
        && payment.entityId === entityId
      ));
      if (existing?.dirty) return;
      const replacement: StoredPayment = {
        serverProfileId,
        databaseId,
        entityId,
        billId,
        payload: JSON.parse(payloadJson) as Record<string, unknown>,
        serverUpdatedAt,
        cachedAt,
        dirty: false,
        deleted: false,
      };
      if (existing) Object.assign(existing, replacement);
      else this.state.payments.push(replacement);
      return;
    }

    if (query.startsWith('DELETE FROM bill_groups')) {
      const [serverProfileId] = params as string[];
      this.state.groups = this.state.groups.filter(
        (group) => group.serverProfileId !== serverProfileId,
      );
      return;
    }

    if (query.startsWith('INSERT INTO bill_groups')) {
      const [serverProfileId, databaseId, , , payloadJson, updatedAt] = params as string[];
      this.state.groups.push({
        serverProfileId,
        databaseId,
        payload: JSON.parse(payloadJson) as Record<string, unknown>,
        updatedAt,
      });
      return;
    }

    if (query.startsWith('INSERT INTO sync_state')) {
      const [serverProfileId, databaseId, synchronizedAt] = params as string[];
      const replacement: StoredSyncState = {
        serverProfileId,
        databaseId,
        cursor: null,
        lastSyncedAt: synchronizedAt,
        status: 'idle',
        lastError: null,
      };
      const existing = this.state.syncStates.find((syncState) => (
        syncState.serverProfileId === serverProfileId
        && syncState.databaseId === databaseId
      ));
      if (existing) Object.assign(existing, replacement);
      else this.state.syncStates.push(replacement);
      return;
    }

    throw new Error(`Unexpected runAsync query: ${query}`);
  }
}

const scope = { serverProfileId: 'server-a', databaseId: 'family' };

function bill(id: number, name: string): Bill {
  return { id, name, archived: false } as Bill;
}

function payment(id: number, billId: number, amount: number): Payment {
  return { id, bill_id: billId, amount, payment_date: '2026-08-12', notes: null };
}

function group(id: number, displayName: string): DatabaseInfo {
  return { id, name: displayName.toLowerCase(), display_name: displayName };
}

describe('MobileCacheRepository atomic synchronization snapshot', () => {
  it('rolls back every cache and sync-state change when a snapshot write fails', async () => {
    const initialState: SnapshotDatabaseState = {
      bills: [{
        serverProfileId: 'server-a',
        databaseId: 'family',
        entityId: '1',
        payload: { id: 1, name: 'Local rent' },
        serverUpdatedAt: null,
        cachedAt: 'before',
        dirty: true,
        archived: false,
      }],
      payments: [{
        serverProfileId: 'server-a',
        databaseId: 'family',
        entityId: '10',
        billId: '1',
        payload: { id: 10, bill_id: 1, amount: 900 },
        serverUpdatedAt: null,
        cachedAt: 'before',
        dirty: true,
        deleted: false,
      }],
      groups: [{
        serverProfileId: 'server-a',
        databaseId: 'family',
        payload: { id: 1, name: 'family', display_name: 'Old family' },
        updatedAt: 'before',
      }],
      outbox: [],
      syncStates: [{
        serverProfileId: 'server-a',
        databaseId: 'family',
        cursor: 'old-cursor',
        lastSyncedAt: '2026-08-11T12:00:00.000Z',
        status: 'syncing',
        lastError: null,
      }],
    };
    const database = new StatefulSnapshotDatabase(cloneState(initialState));
    database.failOnPaymentInsert = true;
    const repository = new MobileCacheRepository(async () => database as never);

    await expect(repository.commitSyncSnapshot(scope, {
      bills: [bill(1, 'Server rent')],
      payments: [payment(10, 1, 1000)],
      groups: [group(1, 'New family')],
    }, '2026-08-12T14:00:00.000Z')).rejects.toThrow('forced payment snapshot failure');

    expect(database.state).toEqual(initialState);
    expect(database.transactionCount).toBe(1);
    expect(database.commitCount).toBe(0);
    expect(database.rollbackCount).toBe(1);
  });

  it('preserves dirty rows when unresolved outbox work exists while committing the snapshot', async () => {
    const database = new StatefulSnapshotDatabase({
      bills: [
        {
          serverProfileId: 'server-a',
          databaseId: 'family',
          entityId: '1',
          payload: { id: 1, name: 'Unsynced local rent' },
          serverUpdatedAt: null,
          cachedAt: 'before',
          dirty: true,
          archived: false,
        },
        {
          serverProfileId: 'server-a',
          databaseId: 'family',
          entityId: '99',
          payload: { id: 99, name: 'Stale clean bill' },
          serverUpdatedAt: null,
          cachedAt: 'before',
          dirty: false,
          archived: false,
        },
      ],
      payments: [
        {
          serverProfileId: 'server-a',
          databaseId: 'family',
          entityId: '10',
          billId: '1',
          payload: { id: 10, bill_id: 1, amount: 900 },
          serverUpdatedAt: null,
          cachedAt: 'before',
          dirty: true,
          deleted: false,
        },
        {
          serverProfileId: 'server-a',
          databaseId: 'family',
          entityId: '99',
          billId: '99',
          payload: { id: 99, bill_id: 99, amount: 5 },
          serverUpdatedAt: null,
          cachedAt: 'before',
          dirty: false,
          deleted: false,
        },
      ],
      groups: [],
      outbox: [{
        serverProfileId: 'server-a',
        databaseId: 'family',
        status: 'pending',
      }],
      syncStates: [{
        serverProfileId: 'server-a',
        databaseId: 'family',
        cursor: 'old-cursor',
        lastSyncedAt: null,
        status: 'syncing',
        lastError: null,
      }],
    });
    const repository = new MobileCacheRepository(async () => database as never);
    const synchronizedAt = '2026-08-12T14:00:00.000Z';

    await expect(repository.commitSyncSnapshot(scope, {
      bills: [bill(1, 'Server rent'), bill(2, 'Server utilities')],
      payments: [payment(10, 1, 1000), payment(20, 2, 200)],
      groups: [group(1, 'Family')],
    }, synchronizedAt)).resolves.toEqual({ hadUnresolvedMutations: true });

    expect(database.state.bills).toEqual([
      expect.objectContaining({
        entityId: '1',
        payload: { id: 1, name: 'Unsynced local rent' },
        dirty: true,
      }),
      expect.objectContaining({
        entityId: '2',
        payload: expect.objectContaining({ id: 2, name: 'Server utilities' }),
        dirty: false,
      }),
    ]);
    expect(database.state.payments).toEqual([
      expect.objectContaining({
        entityId: '10',
        payload: { id: 10, bill_id: 1, amount: 900 },
        dirty: true,
      }),
      expect.objectContaining({
        entityId: '20',
        payload: expect.objectContaining({ id: 20, bill_id: 2, amount: 200 }),
        dirty: false,
      }),
    ]);
    expect(database.state.groups).toEqual([
      expect.objectContaining({
        serverProfileId: 'server-a',
        databaseId: '1',
        payload: { id: 1, name: 'family', display_name: 'Family' },
        updatedAt: synchronizedAt,
      }),
    ]);
    expect(database.state.syncStates).toEqual([
      {
        serverProfileId: 'server-a',
        databaseId: 'family',
        cursor: null,
        lastSyncedAt: synchronizedAt,
        status: 'idle',
        lastError: null,
      },
    ]);
    expect(database.statements).not.toContain(
      'UPDATE bills SET is_dirty = 0 WHERE server_profile_id = ? AND database_id = ?',
    );
    expect(database.transactionCount).toBe(1);
    expect(database.commitCount).toBe(1);
    expect(database.rollbackCount).toBe(0);
  });
});
