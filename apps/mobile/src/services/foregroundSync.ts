import type { BillManagerApi } from '../api/client';
import type { CacheScope, MobileCacheRepository } from '../data/cacheRepository';
import type { ApiResponse, Bill, DatabaseInfo, Payment } from '../types';

export interface ForegroundSyncSnapshot {
  bills: Bill[];
  payments: Payment[];
  groups: DatabaseInfo[];
}

function requireData<T>(envelope: ApiResponse<T>, label: string): T {
  if (!envelope.success || envelope.data === undefined) {
    throw new Error(envelope.error ?? `The server did not return synchronized ${label}.`);
  }
  return envelope.data;
}

/**
 * Reads a synchronization snapshot with an immutable profile/database scope.
 * The foreground profile can change while these requests are in flight; the
 * scoped client keeps the origin, token, and X-Database header bound to the
 * scope that initiated the synchronization.
 */
export async function fetchForegroundSyncSnapshot(
  api: Pick<BillManagerApi, 'requestScopedGet'>,
  scope: CacheScope,
): Promise<ForegroundSyncSnapshot> {
  const [billEnvelope, paymentEnvelope, meEnvelope] = await Promise.all([
    api.requestScopedGet<ApiResponse<Bill[]>>('/bills', scope, {
      include_archived: true,
    }),
    api.requestScopedGet<ApiResponse<Payment[]>>('/payments', scope),
    api.requestScopedGet<ApiResponse<{ databases: DatabaseInfo[] }>>('/me', scope),
  ]);

  return {
    bills: requireData(billEnvelope, 'bills'),
    payments: requireData(paymentEnvelope, 'payments'),
    groups: requireData(meEnvelope, 'bill groups').databases,
  };
}

/** Commits the complete foreground snapshot and idle state atomically. */
export async function persistForegroundSyncSnapshot(
  cacheRepository: Pick<MobileCacheRepository, 'commitSyncSnapshot'>,
  scope: CacheScope,
  snapshot: ForegroundSyncSnapshot,
  synchronizedAt: string,
): Promise<void> {
  await cacheRepository.commitSyncSnapshot(scope, snapshot, synchronizedAt);
}
