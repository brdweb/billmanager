import type { AuthenticatedSessionSnapshot } from '../services/authSession';
import { getMobileDatabase } from './database';
import { withSerializedMobileWrite } from './databaseWriteQueue';

interface AuthSessionRow {
  server_profile_id?: string;
  user_json: string;
  databases_json: string;
  current_database: string | null;
  updated_at: string;
}

export interface StoredSessionScope {
  serverProfileId: string;
  databaseId: string;
}

export interface AuthSessionStore {
  get(profileId: string): Promise<AuthenticatedSessionSnapshot | null>;
  save(profileId: string, snapshot: AuthenticatedSessionSnapshot): Promise<void>;
  setCurrentDatabase(profileId: string, databaseId: string | null): Promise<void>;
  clear(profileId: string): Promise<void>;
}

export class SQLiteAuthSessionStore implements AuthSessionStore {
  constructor(private readonly databaseProvider = getMobileDatabase) {}

  async get(profileId: string): Promise<AuthenticatedSessionSnapshot | null> {
    const database = await this.databaseProvider();
    const row = await database.getFirstAsync<AuthSessionRow>(
      `SELECT user_json, databases_json, current_database, updated_at
       FROM auth_sessions WHERE server_profile_id = ? LIMIT 1`,
      profileId,
    );
    if (!row) return null;
    return {
      user: JSON.parse(row.user_json),
      databases: JSON.parse(row.databases_json),
      currentDatabase: row.current_database,
      updatedAt: row.updated_at,
    } as AuthenticatedSessionSnapshot;
  }

  async save(profileId: string, snapshot: AuthenticatedSessionSnapshot): Promise<void> {
    const database = await this.databaseProvider();
    await withSerializedMobileWrite(database, async () => {
      await database.runAsync(
        `INSERT INTO auth_sessions (
           server_profile_id, user_json, databases_json, current_database, updated_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(server_profile_id) DO UPDATE SET
           user_json = excluded.user_json,
           databases_json = excluded.databases_json,
           current_database = excluded.current_database,
           updated_at = excluded.updated_at`,
        profileId,
        JSON.stringify(snapshot.user),
        JSON.stringify(snapshot.databases),
        snapshot.currentDatabase,
        snapshot.updatedAt,
      );
    });
  }

  async setCurrentDatabase(profileId: string, databaseId: string | null): Promise<void> {
    const database = await this.databaseProvider();
    await withSerializedMobileWrite(database, async () => {
      await database.runAsync(
        `UPDATE auth_sessions SET current_database = ?, updated_at = ?
         WHERE server_profile_id = ?`,
        databaseId,
        new Date().toISOString(),
        profileId,
      );
    });
  }

  async clear(profileId: string): Promise<void> {
    const database = await this.databaseProvider();
    await withSerializedMobileWrite(database, async () => {
      await database.runAsync('DELETE FROM auth_sessions WHERE server_profile_id = ?', profileId);
    });
  }

  async listCurrentScopes(): Promise<StoredSessionScope[]> {
    const database = await this.databaseProvider();
    const rows = await database.getAllAsync<{
      server_profile_id: string;
      current_database: string;
    }>(
      `SELECT server_profile_id, current_database
       FROM auth_sessions
       WHERE current_database IS NOT NULL AND current_database <> ''
       ORDER BY server_profile_id`,
    );
    return rows.map((row) => ({
      serverProfileId: row.server_profile_id,
      databaseId: row.current_database,
    }));
  }
}
