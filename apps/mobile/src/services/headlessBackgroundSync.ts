import { BillManagerApi } from '../api/client';
import { SQLiteAuthSessionStore, type StoredSessionScope } from '../data/authSessionRepository';
import { MobileCacheRepository, type CacheScope } from '../data/cacheRepository';
import { SQLiteSyncRepository, type StoredMutationScope } from '../data/syncRepository';
import type { OutboxStore } from '../domain/sync';
import { scheduleLocalBillReminders } from '../native/localNotifications';
import type { ApiResponse, Bill, Payment } from '../types';
import { ApiOutboxMutationExecutor } from './apiOutboxExecutor';
import { OutboxProcessor } from './outboxProcessor';

export interface HeadlessBackgroundSyncResult {
  scopesAttempted: number;
  scopesSucceeded: number;
  scopesFailed: number;
}

export interface HeadlessBackgroundSyncDependencies {
  api: Pick<BillManagerApi, 'requestScopedGet' | 'requestScopedMutation'>;
  sessions: Pick<SQLiteAuthSessionStore, 'listCurrentScopes'>;
  syncRepository: OutboxStore & Pick<
    SQLiteSyncRepository,
    | 'listMutationScopes'
    | 'getSyncState'
    | 'setSyncState'
    | 'pruneCompleted'
  >;
  cacheRepository: Pick<MobileCacheRepository, 'commitSyncSnapshot'>;
  scheduleReminders: typeof scheduleLocalBillReminders;
  now: () => Date;
}

function uniqueScopes(
  sessionScopes: StoredSessionScope[],
  mutationScopes: StoredMutationScope[],
): CacheScope[] {
  const scopes = new Map<string, CacheScope>();
  for (const scope of [...sessionScopes, ...mutationScopes]) {
    if (!scope.serverProfileId || !scope.databaseId) continue;
    scopes.set(`${scope.serverProfileId}\u0000${scope.databaseId}`, scope);
  }
  return [...scopes.values()];
}

function requireEnvelopeData<T>(response: ApiResponse<T>, label: string): T {
  if (!response.success || response.data === undefined) {
    throw new Error(response.error ?? `The server did not return synchronized ${label}.`);
  }
  return response.data;
}

function defaultDependencies(): HeadlessBackgroundSyncDependencies {
  const api = new BillManagerApi();
  const syncRepository = new SQLiteSyncRepository();
  return {
    api,
    sessions: new SQLiteAuthSessionStore(),
    syncRepository,
    cacheRepository: new MobileCacheRepository(),
    scheduleReminders: scheduleLocalBillReminders,
    now: () => new Date(),
  };
}

export async function runHeadlessBackgroundSync(
  dependencies: HeadlessBackgroundSyncDependencies = defaultDependencies(),
): Promise<HeadlessBackgroundSyncResult> {
  const sessionScopes = await dependencies.sessions.listCurrentScopes();
  const mutationScopes = await dependencies.syncRepository.listMutationScopes();
  const scopes = uniqueScopes(sessionScopes, mutationScopes);
  const processor = new OutboxProcessor(
    dependencies.syncRepository,
    new ApiOutboxMutationExecutor(dependencies.api),
  );
  const result: HeadlessBackgroundSyncResult = {
    scopesAttempted: scopes.length,
    scopesSucceeded: 0,
    scopesFailed: 0,
  };

  for (const scope of scopes) {
    const existing = await dependencies.syncRepository.getSyncState(
      scope.serverProfileId,
      scope.databaseId,
    );
    await dependencies.syncRepository.setSyncState(scope.serverProfileId, scope.databaseId, {
      cursor: existing?.cursor ?? null,
      lastSyncedAt: existing?.lastSyncedAt ?? null,
      status: 'syncing',
      lastError: null,
    });

    try {
      await processor.process(scope.serverProfileId, scope.databaseId);
      const [billEnvelope, paymentEnvelope] = await Promise.all([
        dependencies.api.requestScopedGet<ApiResponse<Bill[]>>('/bills', scope, {
          include_archived: true,
        }),
        dependencies.api.requestScopedGet<ApiResponse<Payment[]>>('/payments', scope),
      ]);
      const bills = requireEnvelopeData(billEnvelope, 'bills');
      const payments = requireEnvelopeData(paymentEnvelope, 'payments');
      const synchronizedAt = dependencies.now().toISOString();
      await dependencies.cacheRepository.commitSyncSnapshot(
        scope,
        { bills, payments },
        synchronizedAt,
      );
      await dependencies.scheduleReminders(bills, { scope }).catch(() => 0);
      result.scopesSucceeded += 1;
    } catch (reason) {
      result.scopesFailed += 1;
      const message = reason instanceof Error ? reason.message : 'Background synchronization failed.';
      await dependencies.syncRepository.setSyncState(scope.serverProfileId, scope.databaseId, {
        cursor: existing?.cursor ?? null,
        lastSyncedAt: existing?.lastSyncedAt ?? null,
        status: 'error',
        lastError: message,
      });
    }
  }

  await dependencies.syncRepository.pruneCompleted(
    new Date(dependencies.now().getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  );
  return result;
}

export const mergeBackgroundSyncScopes = uniqueScopes;
