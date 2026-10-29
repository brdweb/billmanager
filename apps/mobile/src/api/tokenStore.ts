import * as SecureStore from 'expo-secure-store';

export interface ProfileTokens {
  accessToken: string | null;
  refreshToken: string | null;
  principalId?: string;
}

export interface ProfileTokenStore {
  load(profileId: string): Promise<ProfileTokens>;
  save(profileId: string, tokens: ProfileTokens): Promise<void>;
  clear(profileId: string): Promise<void>;
}

export interface LegacySecureStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStore.SecureStoreOptions): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function key(profileId: string, token: 'access' | 'refresh' | 'session'): string {
  return `billmanager_profile_${profileId}_${token}_token`;
}

export class SecureProfileTokenStore implements ProfileTokenStore {
  constructor(private readonly storage: LegacySecureStore = SecureStore) {}

  async load(profileId: string): Promise<ProfileTokens> {
    // Owner and credentials are committed together. A native read must never
    // pair one account's tokens with a different account's identity metadata.
    const envelope = await this.storage.getItemAsync(key(profileId, 'session'));
    if (envelope !== null) {
      try {
        const value = JSON.parse(envelope) as ProfileTokens;
        if ((value.principalId !== undefined && (typeof value.principalId !== 'string' || !value.principalId))
          || (value.accessToken !== null && typeof value.accessToken !== 'string')
          || (value.refreshToken !== null && typeof value.refreshToken !== 'string')) {
          throw new Error('Invalid stored session');
        }
        return value;
      } catch { return { accessToken: null, refreshToken: null }; }
    }
    const [accessToken, refreshToken] = await Promise.all([
      this.storage.getItemAsync(key(profileId, 'access')),
      this.storage.getItemAsync(key(profileId, 'refresh')),
    ]);
    return { accessToken, refreshToken };
  }

  async save(profileId: string, tokens: ProfileTokens): Promise<void> {
    await this.storage.setItemAsync(key(profileId, 'session'), JSON.stringify(tokens), secureOptions);
  }

  async clear(profileId: string): Promise<void> {
    // Keep an atomic tombstone so a concurrent reader never falls back to
    // legacy credentials while their individual native keys are being removed.
    await this.storage.setItemAsync(key(profileId, 'session'), JSON.stringify({ accessToken: null, refreshToken: null }), secureOptions);
    await Promise.all([
      this.storage.deleteItemAsync(key(profileId, 'access')),
      this.storage.deleteItemAsync(key(profileId, 'refresh')),
    ]);
  }
}

export const profileTokenStorageKey = key;
export const profileTokenSecureStoreOptions = secureOptions;
