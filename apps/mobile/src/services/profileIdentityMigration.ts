import type { ProfileTokenStore } from '../api/tokenStore';
import {
  profileIdForBaseUrl,
  type ServerProfileStore,
} from '../domain/serverProfile';

export interface ProfileIdentityMigration {
  previousId: string;
  nextId: string;
}

/**
 * Re-keys alpha profiles from their legacy 32-bit URL hash to SHA-256. Tokens
 * are copied first so a database migration failure leaves the original session
 * usable; the old token keys are removed only after the database transaction.
 */
export async function migrateProfileIdentities(
  profileStore: ServerProfileStore,
  tokenStore: ProfileTokenStore,
): Promise<ProfileIdentityMigration[]> {
  const migrations: ProfileIdentityMigration[] = [];
  for (const profile of await profileStore.list()) {
    if (profile.id === 'billmanager-cloud') continue;

    const nextId = await profileIdForBaseUrl(profile.baseUrl);
    if (profile.id === nextId) continue;
    if (!profileStore.migrateProfileId) {
      throw new Error('The profile store cannot migrate legacy server identities.');
    }
    const existing = await profileStore.getById(nextId);
    if (existing) {
      if (existing.baseUrl !== profile.baseUrl) {
        throw new Error(`A different server profile already uses identity ${nextId}`);
      }
      await tokenStore.clear(profile.id);
      migrations.push({ previousId: profile.id, nextId });
      continue;
    }

    const [sourceTokens, destinationTokens] = await Promise.all([
      tokenStore.load(profile.id),
      tokenStore.load(nextId),
    ]);
    // Credentials and principal are one envelope: never mix a destination
    // account's access token with a source account's refresh token.
    const migratedTokens = destinationTokens.accessToken ? destinationTokens : sourceTokens;
    if (migratedTokens.accessToken || migratedTokens.refreshToken) {
      await tokenStore.save(nextId, migratedTokens);
    }

    await profileStore.migrateProfileId(profile.id, nextId);
    await tokenStore.clear(profile.id);
    migrations.push({ previousId: profile.id, nextId });
  }
  return migrations;
}
