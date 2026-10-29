import type { CacheScope } from '../data/cacheRepository';

function sameScope(left: CacheScope, right: CacheScope): boolean {
  return left.serverProfileId === right.serverProfileId
    && left.databaseId === right.databaseId
    && left.principalId === right.principalId;
}

interface ActiveLease {
  token: symbol;
  scope: CacheScope;
}

let activeLease: ActiveLease | null = null;
let widgetWriteQueue: Promise<void> = Promise.resolve();

/**
 * A lease binds asynchronous foreground-only native work to one mounted
 * profile/database provider. Releasing the lease on a database switch or
 * provider unmount invalidates every continuation that captured it.
 */
export interface ForegroundNativeSurfaceLease {
  readonly scope: CacheScope;
  isActive(targetScope?: CacheScope): boolean;
  release(): void;
}

export function activateForegroundNativeSurfaceScope(
  scope: CacheScope,
): ForegroundNativeSurfaceLease {
  const lease: ActiveLease = {
    token: Symbol('foreground-native-surface'),
    scope: { ...scope },
  };
  let released = false;
  activeLease = lease;

  return {
    scope: { ...scope },
    isActive(targetScope = scope) {
      return !released
        && activeLease?.token === lease.token
        && sameScope(lease.scope, targetScope);
    },
    release() {
      released = true;
      if (activeLease?.token === lease.token) activeLease = null;
    },
  };
}

/**
 * Widget storage is process-global, unlike the SQLite cache. Serialize writes
 * and re-check the lease immediately before committing so queued work from an
 * old provider cannot replace the current profile's snapshot. The new scope
 * always queues a clearing/current snapshot, so if a native write was already
 * in progress at switch time its result is deterministically overwritten.
 */
async function enqueueActiveWidgetWrite(
  lease: ForegroundNativeSurfaceLease,
  scope: CacheScope,
  writeWidget: () => void | Promise<void>,
): Promise<boolean> {
  let wrote = false;
  const queued = widgetWriteQueue
    .catch(() => undefined)
    .then(async () => {
      if (!lease.isActive(scope)) return;
      await writeWidget();
      wrote = true;
    });
  widgetWriteQueue = queued.then(() => undefined, () => undefined);
  await queued;
  return wrote;
}

export interface ForegroundNativeSurfaceUpdate {
  lease: ForegroundNativeSurfaceLease | null;
  scope: CacheScope;
  scheduleReminders?: () => void | Promise<unknown>;
  writeWidget?: () => void | Promise<void>;
}

/**
 * Runs foreground native-surface work only while its exact provider lease is
 * current. The post-await check is essential: notification scheduling may be
 * waiting on the OS while the user changes a database or server profile.
 */
export async function updateForegroundNativeSurfaces({
  lease,
  scope,
  scheduleReminders,
  writeWidget,
}: ForegroundNativeSurfaceUpdate): Promise<boolean> {
  if (!lease?.isActive(scope)) return false;
  if (scheduleReminders) await scheduleReminders();
  if (!lease.isActive(scope)) return false;
  if (!writeWidget) return true;
  return enqueueActiveWidgetWrite(lease, scope, writeWidget);
}
