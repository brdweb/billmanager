import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { withSerializedMobileTransaction } from './databaseWriteQueue';

const DATABASE_NAME = 'billmanager-mobile.db';
const DATABASE_KEY_STORAGE_KEY = 'billmanager_database_key_v1';
const CURRENT_SCHEMA_VERSION = 3;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

const schemaV1 = `
CREATE TABLE IF NOT EXISTS mobile_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS server_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT NOT NULL UNIQUE,
  deployment_mode TEXT NOT NULL CHECK (deployment_mode IN ('saas', 'self_hosted', 'development')),
  last_verified_at TEXT,
  capabilities_json TEXT,
  selected_database TEXT,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_server_profiles_active
  ON server_profiles(is_active) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS bill_groups (
  server_profile_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_profile_id, database_id),
  FOREIGN KEY (server_profile_id) REFERENCES server_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bills (
  server_profile_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  server_updated_at TEXT,
  cached_at TEXT NOT NULL,
  is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  PRIMARY KEY (server_profile_id, database_id, entity_id),
  FOREIGN KEY (server_profile_id) REFERENCES server_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  server_profile_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  server_updated_at TEXT,
  cached_at TEXT NOT NULL,
  is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  PRIMARY KEY (server_profile_id, database_id, entity_id),
  FOREIGN KEY (server_profile_id) REFERENCES server_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payments_bill
  ON payments(server_profile_id, database_id, bill_id);

CREATE TABLE IF NOT EXISTS reminder_state (
  server_profile_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  notification_ids_json TEXT NOT NULL DEFAULT '[]',
  next_scheduled_at TEXT,
  snoozed_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_profile_id, database_id, bill_id),
  FOREIGN KEY (server_profile_id) REFERENCES server_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  server_profile_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  snapshot_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_profile_id, database_id, snapshot_key),
  FOREIGN KEY (server_profile_id) REFERENCES server_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_state (
  server_profile_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  cursor TEXT,
  last_synced_at TEXT,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'syncing', 'error')),
  last_error TEXT,
  PRIMARY KEY (server_profile_id, database_id),
  FOREIGN KEY (server_profile_id) REFERENCES server_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY NOT NULL,
  server_profile_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  base_updated_at TEXT,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  depends_on TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'conflict', 'completed')),
  last_error TEXT,
  FOREIGN KEY (server_profile_id) REFERENCES server_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on) REFERENCES outbox(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_ready
  ON outbox(server_profile_id, database_id, status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS conflicts (
  mutation_id TEXT PRIMARY KEY NOT NULL,
  server_profile_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  local_json TEXT NOT NULL,
  server_json TEXT NOT NULL,
  server_updated_at TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('modified', 'deleted', 'permission_changed')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (mutation_id) REFERENCES outbox(id) ON DELETE CASCADE,
  FOREIGN KEY (server_profile_id) REFERENCES server_profiles(id) ON DELETE CASCADE
);
`;

const schemaV2 = `
CREATE TABLE IF NOT EXISTS auth_sessions (
  server_profile_id TEXT PRIMARY KEY NOT NULL,
  user_json TEXT NOT NULL,
  databases_json TEXT NOT NULL,
  current_database TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (server_profile_id) REFERENCES server_profiles(id) ON DELETE CASCADE
);
`;

const schemaV3 = `
ALTER TABLE reminder_state ADD COLUMN dismissed_due_date TEXT;
`;

async function createSecureRandomKey(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function getOrCreateDatabaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DATABASE_KEY_STORAGE_KEY);
  if (existing) return existing;

  const key = await createSecureRandomKey();
  await SecureStore.setItemAsync(DATABASE_KEY_STORAGE_KEY, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

function escapePragmaValue(value: string): string {
  return value.replace(/'/g, "''");
}

export async function migrateMobileDatabase(database: SQLite.SQLiteDatabase): Promise<void> {
  const result = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = result?.user_version ?? 0;

  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Local database schema ${currentVersion} is newer than supported schema ${CURRENT_SCHEMA_VERSION}.`,
    );
  }
  if (currentVersion < 1) {
    await withSerializedMobileTransaction(database, async () => {
      await database.execAsync(schemaV1);
      await database.execAsync('PRAGMA user_version = 1');
    });
  }
  if (currentVersion < 2) {
    await withSerializedMobileTransaction(database, async () => {
      await database.execAsync(schemaV2);
      await database.execAsync('PRAGMA user_version = 2');
    });
  }
  if (currentVersion < 3) {
    await withSerializedMobileTransaction(database, async () => {
      await database.execAsync(schemaV3);
      await database.execAsync('PRAGMA user_version = 3');
    });
  }
}

async function openMobileDatabase(): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
  const key = await getOrCreateDatabaseKey();

  // SQLCipher is enabled by the Expo config plugin for native builds. PRAGMA key
  // is harmlessly rejected on builds where SQLCipher was not compiled in, so do
  // not silently continue if it fails.
  await database.execAsync(`PRAGMA key = '${escapePragmaValue(key)}'`);
  await database.execAsync('PRAGMA busy_timeout = 5000');
  await database.execAsync('PRAGMA foreign_keys = ON');
  await database.execAsync('PRAGMA journal_mode = WAL');
  await migrateMobileDatabase(database);
  return database;
}

export function getMobileDatabase(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= openMobileDatabase();
  return databasePromise;
}

/** Test-only lifecycle hook; production code should keep one connection. */
export async function resetMobileDatabaseConnection(): Promise<void> {
  const database = await databasePromise;
  databasePromise = null;
  await database?.closeAsync();
}

export const mobileDatabaseSchemaVersion = CURRENT_SCHEMA_VERSION;
