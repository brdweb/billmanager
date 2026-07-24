import type { DatabaseInfo, User } from '../types';

export interface AuthenticatedSessionSnapshot {
  user: User;
  databases: DatabaseInfo[];
  currentDatabase: string | null;
  updatedAt: string;
}

interface SessionPayload {
  user?: unknown;
  databases?: unknown;
  current_db?: unknown;
  [key: string]: unknown;
}

function isUser(value: unknown): value is User {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<User>;
  return (
    typeof candidate.id === 'number'
    && typeof candidate.username === 'string'
    && (candidate.role === 'admin' || candidate.role === 'user')
  );
}

function isDatabaseInfo(value: unknown): value is DatabaseInfo {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DatabaseInfo>;
  return (
    typeof candidate.id === 'number'
    && typeof candidate.name === 'string'
    && typeof candidate.display_name === 'string'
  );
}

/**
 * Normalizes both the current nested /me response and the legacy flat shape.
 * The selected database belongs to the profile and remains authoritative,
 * including the synthetic `_all_` selection which is not returned as a group.
 */
export function authenticatedSessionFromPayload(
  payload: unknown,
  selectedDatabase: string | null,
  now = new Date().toISOString(),
): AuthenticatedSessionSnapshot | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as SessionPayload;
  const source = record.user ?? record;
  if (!isUser(source)) return null;

  const databases = Array.isArray(record.databases)
    ? record.databases.filter(isDatabaseInfo)
    : [];
  const currentDatabase = selectedDatabase
    ?? (typeof record.current_db === 'string' ? record.current_db : null)
    ?? databases[0]?.name
    ?? null;

  return {
    user: {
      id: source.id,
      username: source.username,
      email: source.email,
      role: source.role,
      is_account_owner: source.is_account_owner,
      has_password: source.has_password,
      currency: source.currency,
    },
    databases,
    currentDatabase,
    updatedAt: now,
  };
}

export function canUseCachedSession(
  hasStoredAccessToken: boolean,
  httpStatus: number | undefined,
): boolean {
  if (!hasStoredAccessToken) return false;
  // Missing status means DNS, TLS, timeout, or connectivity failure. A 5xx
  // response also leaves token validity unknown and should retain offline use.
  return httpStatus === undefined || httpStatus >= 500;
}
