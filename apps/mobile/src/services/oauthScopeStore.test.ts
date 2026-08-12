import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async () => 'state-digest'),
}));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

import { oauthScopeTtlMs, SecureOAuthScopeStore } from './oauthScopeStore';

describe('SecureOAuthScopeStore', () => {
  it('loads and consumes an authorization transaction exactly once', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null),
      setItemAsync: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
      deleteItemAsync: vi.fn(async (key: string) => { values.delete(key); }),
    };
    const store = new SecureOAuthScopeStore(storage, () => 1000);
    const transaction = {
      scope: { serverProfileId: 'server-a', databaseId: 'personal' },
      provider: 'google',
      flow: 'login' as const,
      redirectUri: 'https://app.billmanager.app/auth/callback',
    };

    await store.save('oauth-state-a', transaction);

    await expect(store.load('oauth-state-a')).resolves.toEqual(transaction);
    await expect(store.load('oauth-state-a')).resolves.toEqual(transaction);
    await expect(store.consume('oauth-state-a')).resolves.toEqual(transaction);
    await expect(store.consume('oauth-state-a')).resolves.toBeNull();
  });

  it('rejects and deletes an expired authorization scope', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null),
      setItemAsync: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
      deleteItemAsync: vi.fn(async (key: string) => { values.delete(key); }),
    };
    let now = 1000;
    const store = new SecureOAuthScopeStore(storage, () => now);
    await store.save('oauth-state-a', {
      scope: { serverProfileId: 'server-a', databaseId: null },
      provider: 'google',
      flow: 'login',
    });
    now += oauthScopeTtlMs + 1;

    await expect(store.consume('oauth-state-a')).resolves.toBeNull();
    expect(values.size).toBe(0);
  });

  it('discards a cancelled authorization transaction', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null),
      setItemAsync: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
      deleteItemAsync: vi.fn(async (key: string) => { values.delete(key); }),
    };
    const store = new SecureOAuthScopeStore(storage, () => 1000);
    await store.save('cancelled-state', {
      scope: { serverProfileId: 'server-a', databaseId: null },
      provider: 'google',
      flow: 'login',
    });

    await store.discard('cancelled-state');

    await expect(store.load('cancelled-state')).resolves.toBeNull();
    expect(values.size).toBe(0);
  });
});
