import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

import {
  SecureProfileTokenStore,
  profileTokenSecureStoreOptions,
  profileTokenStorageKey,
} from './tokenStore';

describe('SecureProfileTokenStore', () => {
  it('isolates credentials by server profile and uses device-only storage', async () => {
    const storage = {
      getItemAsync: vi.fn().mockResolvedValue(null),
      setItemAsync: vi.fn().mockResolvedValue(undefined),
      deleteItemAsync: vi.fn().mockResolvedValue(undefined),
    };
    const tokenStore = new SecureProfileTokenStore(storage);

    await tokenStore.save('server-a', {
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    });
    await tokenStore.save('server-b', {
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
    });

    expect(profileTokenStorageKey('server-a', 'access')).not.toBe(
      profileTokenStorageKey('server-b', 'access'),
    );
    expect(storage.setItemAsync).toHaveBeenCalledWith(
      profileTokenStorageKey('server-a', 'session'),
      JSON.stringify({ accessToken: 'access-a', refreshToken: 'refresh-a' }),
      profileTokenSecureStoreOptions,
    );
  });
});

describe('atomic principal credential binding', () => {
  it('commits owner and tokens in one native value and preserves legacy fallback only before upgrade', async () => {
    const values = new Map<string, string>([
      [profileTokenStorageKey('server', 'access'), 'legacy-access'],
      [profileTokenStorageKey('server', 'refresh'), 'legacy-refresh'],
    ]);
    const storage = {
      getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null),
      setItemAsync: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
      deleteItemAsync: vi.fn(async (key: string) => { values.delete(key); }),
    };
    const store = new SecureProfileTokenStore(storage);
    expect((await store.load('server')).accessToken).toBe('legacy-access');
    const tokens = { accessToken: 'alice-access', refreshToken: 'alice-refresh', principalId: '1' };
    await store.save('server', tokens);
    expect(await store.load('server')).toEqual(tokens);
    expect(storage.setItemAsync).toHaveBeenCalledTimes(1);
    await store.clear('server');
    expect(await store.load('server')).toEqual({ accessToken: null, refreshToken: null });
  });

  it('fails closed on a malformed atomic session instead of resurrecting older legacy tokens', async () => {
    const store = new SecureProfileTokenStore({
      getItemAsync: async (key) => key === profileTokenStorageKey('server', 'session') ? '{broken' : 'legacy',
      setItemAsync: vi.fn(), deleteItemAsync: vi.fn(),
    });
    expect(await store.load('server')).toEqual({ accessToken: null, refreshToken: null });
  });
});
