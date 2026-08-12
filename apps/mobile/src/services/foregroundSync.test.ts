import { describe, expect, it, vi } from 'vitest';

import type { BillManagerApi } from '../api/client';
import {
  fetchForegroundSyncSnapshot,
  persistForegroundSyncSnapshot,
} from './foregroundSync';

describe('fetchForegroundSyncSnapshot', () => {
  it('binds every read to the profile and database that started the sync', async () => {
    const initiatingScope = { serverProfileId: 'server-a', databaseId: 'family' };
    let currentlySelectedProfile = 'server-a';
    const requestScopedGet = vi.fn(async (path: string, scope: typeof initiatingScope) => {
      currentlySelectedProfile = 'server-b';
      expect(scope).toEqual(initiatingScope);
      if (path === '/bills') return { success: true, data: [{ id: 1, name: 'Rent' }] };
      if (path === '/payments') return { success: true, data: [{ id: 2, bill_id: 1 }] };
      return { success: true, data: { databases: [{ id: 3, name: 'Family' }] } };
    });

    const snapshot = await fetchForegroundSyncSnapshot(
      { requestScopedGet } as unknown as BillManagerApi,
      initiatingScope,
    );

    expect(currentlySelectedProfile).toBe('server-b');
    expect(requestScopedGet).toHaveBeenCalledTimes(3);
    expect(requestScopedGet).toHaveBeenCalledWith(
      '/bills',
      initiatingScope,
      { include_archived: true },
    );
    expect(snapshot).toMatchObject({
      bills: [{ id: 1, name: 'Rent' }],
      payments: [{ id: 2, bill_id: 1 }],
      groups: [{ id: 3, name: 'Family' }],
    });
  });

  it('commits the complete foreground snapshot atomically', async () => {
    const commitSyncSnapshot = vi.fn().mockResolvedValue({
      hadUnresolvedMutations: false,
    });
    const cacheRepository = {
      commitSyncSnapshot,
    };
    const scope = { serverProfileId: 'server-a', databaseId: 'family' };
    const snapshot = {
      bills: [{ id: 1, name: 'Rent' }],
      payments: [{ id: 2, bill_id: 1 }],
      groups: [{ id: 3, name: 'Family' }],
    } as never;
    const synchronizedAt = '2026-08-12T14:00:00.000Z';

    await persistForegroundSyncSnapshot(
      cacheRepository,
      scope,
      snapshot,
      synchronizedAt,
    );

    expect(commitSyncSnapshot).toHaveBeenCalledOnce();
    expect(commitSyncSnapshot).toHaveBeenCalledWith(scope, snapshot, synchronizedAt);
  });

  it('propagates an atomic foreground snapshot failure', async () => {
    const failure = new Error('snapshot commit failed');
    const cacheRepository = {
      commitSyncSnapshot: vi.fn().mockRejectedValue(failure),
    };

    await expect(persistForegroundSyncSnapshot(
      cacheRepository,
      { serverProfileId: 'server-a', databaseId: 'family' },
      { bills: [], payments: [], groups: [] },
      '2026-08-12T14:00:00.000Z',
    )).rejects.toBe(failure);

    expect(cacheRepository.commitSyncSnapshot).toHaveBeenCalledOnce();
  });
});
