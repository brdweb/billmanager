import * as Crypto from 'expo-crypto';

export type DeploymentMode = 'saas' | 'self_hosted' | 'development';

export interface ServerCapabilities {
  mobileContractVersion: number;
  serverVersion: string;
  minimumMobileVersion: string | null;
  defaultCurrency: string;
  supportedCurrencies: string[];
  defaultLocale: string;
  registration: boolean;
  oauthProviders: string[];
  emailOtp: boolean;
  passkeys: boolean;
  billing: boolean;
  administration: boolean;
  sharing: boolean;
  settlements: boolean;
}

export interface ServerProfile {
  id: string;
  displayName: string;
  /** Normalized API v2 base URL, without a trailing slash. */
  baseUrl: string;
  deploymentMode: DeploymentMode;
  lastVerifiedAt: string | null;
  capabilities: ServerCapabilities | null;
}

export interface PersistedServerProfile extends ServerProfile {
  selectedDatabase: string | null;
  isActive: boolean;
}

export interface ServerProfileStore {
  getActive(): Promise<PersistedServerProfile | null>;
  getById(profileId: string): Promise<PersistedServerProfile | null>;
  list(): Promise<PersistedServerProfile[]>;
  upsert(profile: PersistedServerProfile): Promise<void>;
  setActive(profileId: string): Promise<void>;
  setSelectedDatabase(profileId: string, databaseId: string | null): Promise<void>;
  /** Atomically re-keys a profile and every profile-scoped database row. */
  migrateProfileId?(profileId: string, nextProfileId: string): Promise<void>;
}

export const CLOUD_API_BASE_URL = 'https://app.billmanager.app/api/v2';

export function defaultCloudProfile(): PersistedServerProfile {
  return {
    id: 'billmanager-cloud',
    displayName: 'BillManager Cloud',
    baseUrl: CLOUD_API_BASE_URL,
    deploymentMode: 'saas',
    lastVerifiedAt: null,
    capabilities: null,
    selectedDatabase: null,
    isActive: true,
  };
}

/** The pre-1.0 profile identifier, retained only to recognize migrated data. */
export function legacyProfileIdForBaseUrl(baseUrl: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < baseUrl.length; index += 1) {
    hash ^= baseUrl.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `server-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * A stable, non-secret, collision-resistant identifier for a normalized server
 * URL. The versioned prefix makes future identity migrations explicit.
 */
export async function profileIdForBaseUrl(baseUrl: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    baseUrl,
  );
  return `server-v2-${digest.toLowerCase()}`;
}
