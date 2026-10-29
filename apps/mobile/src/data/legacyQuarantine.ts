import { getMobileDatabase } from './database';

export interface LegacyDataStatus { hasData: boolean; hasPendingChanges: boolean }

/** Read only existence flags; never expose another account's legacy payload. */
export async function getLegacyDataStatus(profileId: string, databaseProvider = getMobileDatabase): Promise<LegacyDataStatus> {
  const db = await databaseProvider();
  const row = await db.getFirstAsync<{ has_data: number; has_pending_changes: number }>(`
    SELECT EXISTS(SELECT 1 FROM bills WHERE server_profile_id = ? AND database_id LIKE '@legacy/%'
      UNION ALL SELECT 1 FROM payments WHERE server_profile_id = ? AND database_id LIKE '@legacy/%') AS has_data,
      EXISTS(SELECT 1 FROM outbox WHERE server_profile_id = ? AND database_id LIKE '@legacy/%'
        AND status IN ('pending','processing','retry','conflict')) AS has_pending_changes`, profileId, profileId, profileId);
  return { hasData: Boolean(row?.has_data), hasPendingChanges: Boolean(row?.has_pending_changes) };
}

export function legacyNoticeKind(status: LegacyDataStatus | undefined, lastSyncedAt: string | null): 'recovery' | 'reconnect' | null {
  if (status?.hasPendingChanges) return 'recovery';
  return status?.hasData && !lastSyncedAt ? 'reconnect' : null;
}
