import type { CacheScope } from '../data/cacheRepository';

export interface NotificationScopeActivationDependencies {
  getActiveProfileId: () => string;
  getCurrentDatabase: () => string | null;
  getPrincipalId?: () => string | undefined;
  switchProfile: (profileId: string) => void | Promise<void>;
  selectDatabase: (databaseId: string) => void | Promise<void>;
}

/**
 * Activates the exact scope embedded in a local notification. The database is
 * deliberately read again after a server switch; database names can match
 * across profiles while referring to different tenant data.
 */
export async function activateNotificationScope(
  target: CacheScope,
  dependencies: NotificationScopeActivationDependencies,
): Promise<void> {
  if (target.serverProfileId !== dependencies.getActiveProfileId()) {
    await dependencies.switchProfile(target.serverProfileId);
  }
  if (target.principalId && target.principalId !== dependencies.getPrincipalId?.()) {
    throw new Error('This reminder belongs to another signed-in account.');
  }
  if (target.databaseId !== dependencies.getCurrentDatabase()) {
    await dependencies.selectDatabase(target.databaseId);
  }
}
