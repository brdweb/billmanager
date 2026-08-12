import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-crypto', () => ({ getRandomBytesAsync: vi.fn() }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('../native/localNotifications', () => ({
  scheduleLocalBillReminders: vi.fn(),
}));

import { runHeadlessBackgroundSync } from './headlessBackgroundSync';

describe('headless background synchronization', () => {
  it('deduplicates persisted scopes and refreshes each without activating it', async () => {
    const requestScopedGet = vi.fn(async (path: string, scope: { databaseId: string }) => ({
      success: true,
      data: path === '/bills'
        ? [{ id: scope.databaseId === 'family' ? 1 : 2, name: 'Rent' }]
        : [{ id: 9, bill_id: 1, amount: 100 }],
    }));
    const syncRepository = {
      enqueue: vi.fn(),
      getReady: vi.fn().mockResolvedValue([]),
      applyResult: vi.fn(),
      markProcessing: vi.fn(),
      markCompleted: vi.fn(),
      markRetry: vi.fn(),
      markConflict: vi.fn(),
      listMutationScopes: vi.fn().mockResolvedValue([
        { serverProfileId: 'server-home', databaseId: 'family' },
        { serverProfileId: 'billmanager-cloud', databaseId: 'personal' },
      ]),
      getSyncState: vi.fn().mockResolvedValue(null),
      setSyncState: vi.fn(),
      pruneCompleted: vi.fn(),
    };
    const cacheRepository = {
      commitSyncSnapshot: vi.fn().mockResolvedValue({ hadUnresolvedMutations: false }),
    };
    const scheduleReminders = vi.fn().mockResolvedValue(1);

    const result = await runHeadlessBackgroundSync({
      api: {
        requestScopedGet,
        requestScopedMutation: vi.fn(),
      } as never,
      sessions: {
        listCurrentScopes: vi.fn().mockResolvedValue([
          { serverProfileId: 'server-home', databaseId: 'family' },
        ]),
      },
      syncRepository: syncRepository as never,
      cacheRepository,
      scheduleReminders,
      now: () => new Date('2026-07-15T12:00:00.000Z'),
    });

    expect(result).toEqual({ scopesAttempted: 2, scopesSucceeded: 2, scopesFailed: 0 });
    expect(requestScopedGet).toHaveBeenCalledTimes(4);
    expect(requestScopedGet).toHaveBeenCalledWith(
      '/bills',
      { serverProfileId: 'server-home', databaseId: 'family' },
      { include_archived: true },
    );
    expect(cacheRepository.commitSyncSnapshot).toHaveBeenCalledTimes(2);
    expect(cacheRepository.commitSyncSnapshot).toHaveBeenCalledWith(
      { serverProfileId: 'server-home', databaseId: 'family' },
      {
        bills: [{ id: 1, name: 'Rent' }],
        payments: [{ id: 9, bill_id: 1, amount: 100 }],
      },
      '2026-07-15T12:00:00.000Z',
    );
    expect(scheduleReminders).toHaveBeenCalledTimes(2);
    expect(syncRepository.setSyncState).toHaveBeenCalledWith(
      'server-home',
      'family',
      expect.objectContaining({ status: 'syncing' }),
    );
  });

  it('serializes atomic snapshot commits across every persisted scope', async () => {
    let activeCommits = 0;
    let maxActiveCommits = 0;
    const events: string[] = [];
    const commitSyncSnapshot = vi.fn(async (scope: { databaseId: string }) => {
      events.push(`${scope.databaseId}:start`);
      activeCommits += 1;
      maxActiveCommits = Math.max(maxActiveCommits, activeCommits);
      await Promise.resolve();
      activeCommits -= 1;
      events.push(`${scope.databaseId}:finish`);
      return { hadUnresolvedMutations: false };
    });
    const syncRepository = {
      enqueue: vi.fn(),
      getReady: vi.fn().mockResolvedValue([]),
      applyResult: vi.fn(),
      markProcessing: vi.fn(),
      markCompleted: vi.fn(),
      markRetry: vi.fn(),
      markConflict: vi.fn(),
      listMutationScopes: vi.fn().mockResolvedValue([]),
      getSyncState: vi.fn().mockResolvedValue(null),
      setSyncState: vi.fn(),
      pruneCompleted: vi.fn(),
    };
    const cacheRepository = {
      commitSyncSnapshot,
    };

    const result = await runHeadlessBackgroundSync({
      api: {
        requestScopedGet: vi.fn(async () => ({ success: true, data: [] })),
        requestScopedMutation: vi.fn(),
      } as never,
      sessions: {
        listCurrentScopes: vi.fn().mockResolvedValue([
          { serverProfileId: 'server-home', databaseId: 'family' },
          { serverProfileId: 'server-home', databaseId: 'personal' },
        ]),
      },
      syncRepository: syncRepository as never,
      cacheRepository,
      scheduleReminders: vi.fn().mockResolvedValue(0),
      now: () => new Date('2026-07-15T12:00:00.000Z'),
    });

    expect(result).toEqual({ scopesAttempted: 2, scopesSucceeded: 2, scopesFailed: 0 });
    expect(maxActiveCommits).toBe(1);
    expect(events).toEqual([
      'family:start',
      'family:finish',
      'personal:start',
      'personal:finish',
    ]);
  });

  it('marks a failed scope and continues with the next scope', async () => {
    const syncRepository = {
      enqueue: vi.fn(),
      getReady: vi.fn().mockResolvedValue([]),
      applyResult: vi.fn(),
      markProcessing: vi.fn(),
      markCompleted: vi.fn(),
      markRetry: vi.fn(),
      markConflict: vi.fn(),
      listMutationScopes: vi.fn().mockResolvedValue([]),
      getSyncState: vi.fn().mockResolvedValue(null),
      setSyncState: vi.fn(),
      pruneCompleted: vi.fn(),
    };
    const commitSyncSnapshot = vi.fn(async (scope: { databaseId: string }) => {
      if (scope.databaseId === 'family') throw new Error('snapshot commit failed');
      return { hadUnresolvedMutations: false };
    });

    const result = await runHeadlessBackgroundSync({
      api: {
        requestScopedGet: vi.fn(async () => ({ success: true, data: [] })),
        requestScopedMutation: vi.fn(),
      } as never,
      sessions: {
        listCurrentScopes: vi.fn().mockResolvedValue([
          { serverProfileId: 'server-home', databaseId: 'family' },
          { serverProfileId: 'server-home', databaseId: 'personal' },
        ]),
      },
      syncRepository: syncRepository as never,
      cacheRepository: {
        commitSyncSnapshot,
      },
      scheduleReminders: vi.fn().mockResolvedValue(0),
      now: () => new Date('2026-07-15T12:00:00.000Z'),
    });

    expect(result).toEqual({ scopesAttempted: 2, scopesSucceeded: 1, scopesFailed: 1 });
    expect(commitSyncSnapshot).toHaveBeenCalledTimes(2);
    expect(syncRepository.setSyncState).toHaveBeenCalledWith(
      'server-home',
      'family',
      expect.objectContaining({ status: 'error', lastError: 'snapshot commit failed' }),
    );
    expect(syncRepository.setSyncState).toHaveBeenCalledWith(
      'server-home',
      'personal',
      expect.objectContaining({ status: 'syncing' }),
    );
  });
});
