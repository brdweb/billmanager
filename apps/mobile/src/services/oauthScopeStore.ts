import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { LegacySecureStore } from '../api/tokenStore';
import type { OAuthTransaction } from '../features/auth/types';

const OAUTH_TRANSACTION_PREFIX = 'billmanager_oauth_transaction_v2_';
const OAUTH_SCOPE_TTL_MS = 15 * 60 * 1000;

interface StoredOAuthTransaction extends OAuthTransaction {
  createdAt: number;
}

export interface OAuthScopeStore {
  save(state: string, transaction: OAuthTransaction): Promise<void>;
  load(state: string): Promise<OAuthTransaction | null>;
  consume(state: string): Promise<OAuthTransaction | null>;
  discard(state: string): Promise<void>;
}

async function storageKey(state: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    state,
  );
  return `${OAUTH_TRANSACTION_PREFIX}${digest.toLowerCase()}`;
}

export class SecureOAuthScopeStore implements OAuthScopeStore {
  constructor(
    private readonly storage: LegacySecureStore = SecureStore,
    private readonly now: () => number = Date.now,
  ) {}

  async save(state: string, transaction: OAuthTransaction): Promise<void> {
    const value: StoredOAuthTransaction = { ...transaction, createdAt: this.now() };
    await this.storage.setItemAsync(
      await storageKey(state),
      JSON.stringify(value),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  }

  async load(state: string): Promise<OAuthTransaction | null> {
    const key = await storageKey(state);
    const raw = await this.storage.getItemAsync(key);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as StoredOAuthTransaction;
      if (
        !value.scope?.serverProfileId
        || !value.provider
        || (value.flow !== 'login' && value.flow !== 'link')
        || typeof value.createdAt !== 'number'
        || this.now() - value.createdAt > OAUTH_SCOPE_TTL_MS
      ) {
        await this.storage.deleteItemAsync(key);
        return null;
      }
      return {
        scope: {
          serverProfileId: value.scope.serverProfileId,
          databaseId: value.scope.databaseId ?? null,
        },
        provider: value.provider,
        flow: value.flow,
        ...(value.redirectUri ? { redirectUri: value.redirectUri } : {}),
      };
    } catch {
      await this.storage.deleteItemAsync(key);
      return null;
    }
  }

  async consume(state: string): Promise<OAuthTransaction | null> {
    const transaction = await this.load(state);
    if (!transaction) return null;
    await this.storage.deleteItemAsync(await storageKey(state));
    return transaction;
  }

  async discard(state: string): Promise<void> {
    await this.storage.deleteItemAsync(await storageKey(state));
  }
}

export const oauthScopeTtlMs = OAUTH_SCOPE_TTL_MS;
