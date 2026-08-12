import type * as SQLite from 'expo-sqlite';
import {
  PersistedServerProfile,
  ServerCapabilities,
  ServerProfileStore,
} from '../domain/serverProfile';
import { getMobileDatabase } from './database';
import {
  withSerializedMobileTransaction,
  withSerializedMobileWrite,
} from './databaseWriteQueue';

interface ProfileRow {
  id: string;
  display_name: string;
  base_url: string;
  deployment_mode: PersistedServerProfile['deploymentMode'];
  last_verified_at: string | null;
  capabilities_json: string | null;
  selected_database: string | null;
  is_active: number;
}

const PROFILE_SCOPED_TABLES = [
  'bill_groups',
  'bills',
  'payments',
  'reminder_state',
  'analytics_snapshots',
  'sync_state',
  'outbox',
  'conflicts',
  'auth_sessions',
] as const;

function fromRow(row: ProfileRow): PersistedServerProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    baseUrl: row.base_url,
    deploymentMode: row.deployment_mode,
    lastVerifiedAt: row.last_verified_at,
    capabilities: row.capabilities_json
      ? (JSON.parse(row.capabilities_json) as ServerCapabilities)
      : null,
    selectedDatabase: row.selected_database,
    isActive: row.is_active === 1,
  };
}

export class SQLiteServerProfileStore implements ServerProfileStore {
  constructor(private readonly databaseProvider = getMobileDatabase) {}

  async getActive(): Promise<PersistedServerProfile | null> {
    const database = await this.databaseProvider();
    const row = await database.getFirstAsync<ProfileRow>(
      'SELECT * FROM server_profiles WHERE is_active = 1 LIMIT 1',
    );
    return row ? fromRow(row) : null;
  }

  async getById(profileId: string): Promise<PersistedServerProfile | null> {
    const database = await this.databaseProvider();
    const row = await database.getFirstAsync<ProfileRow>(
      'SELECT * FROM server_profiles WHERE id = ? LIMIT 1',
      profileId,
    );
    return row ? fromRow(row) : null;
  }

  async list(): Promise<PersistedServerProfile[]> {
    const database = await this.databaseProvider();
    const rows = await database.getAllAsync<ProfileRow>(
      'SELECT * FROM server_profiles ORDER BY is_active DESC, display_name COLLATE NOCASE',
    );
    return rows.map(fromRow);
  }

  async upsert(profile: PersistedServerProfile): Promise<void> {
    const database = await this.databaseProvider();
    const now = new Date().toISOString();
    await withSerializedMobileTransaction(database, async () => {
      if (profile.isActive) {
        await database.runAsync('UPDATE server_profiles SET is_active = 0 WHERE is_active = 1');
      }
      await database.runAsync(
        `INSERT INTO server_profiles (
           id, display_name, base_url, deployment_mode, last_verified_at,
           capabilities_json, selected_database, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           base_url = excluded.base_url,
           deployment_mode = excluded.deployment_mode,
           last_verified_at = excluded.last_verified_at,
           capabilities_json = excluded.capabilities_json,
           selected_database = COALESCE(excluded.selected_database, server_profiles.selected_database),
           is_active = excluded.is_active,
           updated_at = excluded.updated_at`,
        profile.id,
        profile.displayName,
        profile.baseUrl,
        profile.deploymentMode,
        profile.lastVerifiedAt,
        profile.capabilities ? JSON.stringify(profile.capabilities) : null,
        profile.selectedDatabase,
        profile.isActive ? 1 : 0,
        now,
        now,
      );
    });
  }

  async setActive(profileId: string): Promise<void> {
    const database = await this.databaseProvider();
    await withSerializedMobileTransaction(database, async () => {
      await database.runAsync('UPDATE server_profiles SET is_active = 0 WHERE is_active = 1');
      const result = await database.runAsync(
        'UPDATE server_profiles SET is_active = 1, updated_at = ? WHERE id = ?',
        new Date().toISOString(),
        profileId,
      );
      if (result.changes !== 1) {
        throw new Error(`Unknown server profile: ${profileId}`);
      }
    });
  }

  async setSelectedDatabase(profileId: string, databaseId: string | null): Promise<void> {
    const database = await this.databaseProvider();
    const result = await withSerializedMobileWrite(
      database,
      () => database.runAsync(
        'UPDATE server_profiles SET selected_database = ?, updated_at = ? WHERE id = ?',
        databaseId,
        new Date().toISOString(),
        profileId,
      ),
    );
    if (result.changes !== 1) {
      throw new Error(`Unknown server profile: ${profileId}`);
    }
  }

  async migrateProfileId(profileId: string, nextProfileId: string): Promise<void> {
    if (profileId === nextProfileId) return;
    const database = await this.databaseProvider();
    await withSerializedMobileTransaction(database, async () => {
      const collision = await database.getFirstAsync<{ base_url: string }>(
        'SELECT base_url FROM server_profiles WHERE id = ? LIMIT 1',
        nextProfileId,
      );
      if (collision) {
        throw new Error(`A different server profile already uses identity ${nextProfileId}`);
      }

      // These foreign keys predate ON UPDATE CASCADE. Defer their checks until
      // every scoped table has been re-keyed inside this transaction.
      await database.execAsync('PRAGMA defer_foreign_keys = ON');
      const result = await database.runAsync(
        'UPDATE server_profiles SET id = ?, updated_at = ? WHERE id = ?',
        nextProfileId,
        new Date().toISOString(),
        profileId,
      );
      if (result.changes !== 1) {
        throw new Error(`Unknown server profile: ${profileId}`);
      }
      for (const table of PROFILE_SCOPED_TABLES) {
        await database.runAsync(
          `UPDATE ${table} SET server_profile_id = ? WHERE server_profile_id = ?`,
          nextProfileId,
          profileId,
        );
      }
    });
  }
}

export type MobileSQLiteDatabase = SQLite.SQLiteDatabase;
