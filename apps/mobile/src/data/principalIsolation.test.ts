import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-crypto', () => ({ getRandomBytesAsync: vi.fn() }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn() }));

import { migrateMobileDatabase } from './database';
import { MobileCacheRepository } from './cacheRepository';
import { getLegacyDataStatus, legacyNoticeKind } from './legacyQuarantine';
import { SQLiteSyncRepository } from './syncRepository';
import type { Bill, Payment } from '../types';
import type { OutboxMutation } from '../domain/sync';

const connections: DatabaseSync[] = [];
async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  connections.push(sqlite);
  const db = {
    execAsync: async (sql: string) => { sqlite.exec(sql); },
    runAsync: async (sql: string, ...args: unknown[]) => sqlite.prepare(sql).run(...args as never[]),
    getFirstAsync: async (sql: string, ...args: unknown[]) => sqlite.prepare(sql).get(...args as never[]) ?? null,
    getAllAsync: async (sql: string, ...args: unknown[]) => sqlite.prepare(sql).all(...args as never[]),
    withTransactionAsync: async (run: () => Promise<void>) => {
      sqlite.exec('BEGIN');
      try { await run(); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  await migrateMobileDatabase(db as never);
  await db.runAsync(`INSERT INTO server_profiles (id,display_name,base_url,deployment_mode,created_at,updated_at)
    VALUES ('server','Server','https://server.test','saas','now','now')`);
  const provider = async () => db as never;
  return { db, cache: new MobileCacheRepository(provider), sync: new SQLiteSyncRepository(provider) };
}
const alice = { serverProfileId: 'server', databaseId: 'family', principalId: '1' };
const bob = { ...alice, principalId: '2' };
function bill(name: string) { return { id: 7, name, next_due: '2026-11-01' } as Bill; }
function mutation(scope = alice): OutboxMutation {
  return { ...scope, id: `mutation-${scope.principalId}`, entity: 'bill', entityId: '7', operation: 'update',
    payload: { name: 'Alice update' }, baseUpdatedAt: 'old', createdAt: '2026-10-01', attempts: 0,
    nextAttemptAt: null, dependsOn: null, status: 'pending', lastError: null };
}
afterEach(() => { connections.splice(0).forEach((db) => db.close()); });

describe('durable principal isolation using real SQLite', () => {
  it('keeps same-database bills, payments and snapshots private while preserving returning-account offline data', async () => {
    const { cache } = await fixture();
    await cache.upsertBills(alice, [bill('Alice private')]);
    await cache.upsertPayments(alice, [{ id: 9, bill_id: 7, amount: 20 } as Payment]);
    await cache.putAnalyticsSnapshot(alice, 'collaboration-v1', { private: 'Alice shares' }, null);
    expect(await cache.getBills(bob)).toEqual([]);
    expect(await cache.getPayments(bob)).toEqual([]);
    expect(await cache.getAnalyticsSnapshot(bob, 'collaboration-v1')).toBeNull();
    await cache.upsertBills(bob, [bill('Bob private')]);
    // Simulate a late result from an unmounted Alice session after Bob signed in.
    await cache.replaceBills(alice, [bill('Alice late result')]);
    expect((await cache.getBills(bob))[0].name).toBe('Bob private');
    expect((await cache.getBills(alice))[0].name).toBe('Alice late result');
    expect((await cache.getPayments(alice))[0].amount).toBe(20);
  });

  it('partitions group replacement instead of deleting another account groups', async () => {
    const { cache } = await fixture();
    await cache.replaceGroups('server', [{ id: 1, name: 'family', display_name: 'Alice group' }], '1');
    await cache.replaceGroups('server', [{ id: 1, name: 'family', display_name: 'Bob group' }], '2');
    expect((await cache.getGroups('server', '1'))[0].display_name).toBe('Alice group');
    expect((await cache.getGroups('server', '2'))[0].display_name).toBe('Bob group');
  });

  it('isolates outbox recovery and server-result commits by immutable owner', async () => {
    const { cache, sync } = await fixture();
    await cache.upsertBills(alice, [bill('Alice')], { dirty: true });
    await cache.upsertBills(bob, [bill('Bob')], { dirty: true });
    await sync.enqueue(mutation());
    expect(await sync.getReady('server', 'family', '2026-11-01', '2')).toEqual([]);
    const [queued] = await sync.getReady('server', 'family', '2026-11-01', '1');
    expect(queued.principalId).toBe('1');
    expect(queued.databaseId).toBe('family');
    await sync.applyResult(queued, { serverEntity: bill('Alice server'), serverUpdatedAt: 'new' });
    expect((await cache.getBills(bob))[0].name).toBe('Bob');
    expect(await sync.hasUnresolvedMutations('server', 'family', '1')).toBe(true);
  });

  it('never assigns legacy Alice rows to Bob just because Bob was the last signed-in account', async () => {
    const { db, cache, sync } = await fixture();
    await cache.upsertBills({ serverProfileId: 'server', databaseId: 'family' }, [bill('Legacy Alice')]);
    await sync.enqueue({ ...mutation(), principalId: undefined });
    await db.runAsync(`INSERT INTO auth_sessions VALUES ('server', ?, '[]', 'family', 'now')`, JSON.stringify({ id: 2 }));
    await db.execAsync('PRAGMA user_version = 3');
    await migrateMobileDatabase(db as never);
    expect(await cache.getBills(alice)).toEqual([]);
    expect(await cache.getBills(bob)).toEqual([]);
    expect(await sync.getReady('server', 'family', '2026-11-01', '1')).toEqual([]);
    expect(await sync.getReady('server', 'family', '2026-11-01', '2')).toEqual([]);
    expect(await db.getFirstAsync('SELECT payload_json, database_id FROM bills')).toMatchObject({
      database_id: '@legacy/family', payload_json: JSON.stringify(bill('Legacy Alice')),
    });
    expect(await db.getFirstAsync('SELECT status FROM outbox')).toMatchObject({ status: 'pending' });
  });

  it('rolls back interrupted legacy ownership migration and retries without double-prefixing', async () => {
    const { db, cache } = await fixture();
    await cache.upsertBills({ serverProfileId: 'server', databaseId: 'family' }, [bill('Legacy')]);
    await db.runAsync(`INSERT INTO auth_sessions VALUES ('server', ?, '[]', 'family', 'now')`, JSON.stringify({ id: 1 }));
    await db.execAsync('PRAGMA user_version = 3');
    const run = db.runAsync;
    db.runAsync = async (sql, ...args) => {
      if (sql.startsWith('UPDATE payments')) throw new Error('interrupted');
      return run(sql, ...args);
    };
    await expect(migrateMobileDatabase(db as never)).rejects.toThrow('interrupted');
    expect(await db.getFirstAsync('PRAGMA user_version')).toMatchObject({ user_version: 3 });
    db.runAsync = run;
    await migrateMobileDatabase(db as never);
    expect(await cache.getBills(alice)).toEqual([]);
    expect(await db.getFirstAsync('SELECT database_id FROM bills')).toMatchObject({ database_id: '@legacy/family' });
    expect(await db.getFirstAsync('PRAGMA user_version')).toMatchObject({ user_version: 4 });
  });

  it('keeps recovery visible after a successful sync when quarantined offline changes remain', async () => {
    const { db, sync } = await fixture();
    await sync.enqueue({ ...mutation(), databaseId: '@legacy/family', principalId: undefined });
    const status = await getLegacyDataStatus('server', async () => db as never);
    expect(status.hasPendingChanges).toBe(true);
    expect(legacyNoticeKind(status, '2026-10-29')).toBe('recovery');
    expect(legacyNoticeKind({ hasData: true, hasPendingChanges: false }, null)).toBe('reconnect');
    expect(legacyNoticeKind({ hasData: true, hasPendingChanges: false }, '2026-10-29')).toBeNull();
  });

});
