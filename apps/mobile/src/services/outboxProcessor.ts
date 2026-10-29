import {
  OutboxMutationExecutor,
  OutboxStore,
  syncObjectKey,
} from '../domain/sync';
import { errorMessage, mapSyncConflict } from './conflictMapper';

export interface OutboxProcessSummary {
  attempted: number;
  completed: number;
  conflicts: number;
  retries: number;
}

export interface OutboxProcessorOptions {
  now?: () => Date;
  random?: () => number;
  maxRetryDelayMs?: number;
}

export class OutboxProcessor {
  private readonly activeScopes = new Map<string, Promise<OutboxProcessSummary>>();
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly maxRetryDelayMs: number;

  constructor(
    private readonly store: OutboxStore,
    private readonly executor: OutboxMutationExecutor,
    options: OutboxProcessorOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 15 * 60 * 1000;
  }

  process(serverProfileId: string, databaseId: string, principalId?: string): Promise<OutboxProcessSummary> {
    const scopeKey = `${serverProfileId}\u0000${principalId ?? ''}\u0000${databaseId}`;
    const current = this.activeScopes.get(scopeKey);
    if (current) return current;

    const processing = this.processScope(serverProfileId, databaseId, principalId).finally(() => {
      this.activeScopes.delete(scopeKey);
    });
    this.activeScopes.set(scopeKey, processing);
    return processing;
  }

  private async processScope(
    serverProfileId: string,
    databaseId: string,
    principalId?: string,
  ): Promise<OutboxProcessSummary> {
    const summary: OutboxProcessSummary = {
      attempted: 0,
      completed: 0,
      conflicts: 0,
      retries: 0,
    };
    const mutations = await this.store.getReady(
      serverProfileId,
      databaseId,
      this.now().toISOString(),
      ...(principalId ? [principalId] : []),
    );

    for (const mutation of mutations) {
      summary.attempted += 1;
      await this.store.markProcessing(mutation.id);
      try {
        const result = await this.executor.execute(mutation);
        await this.store.applyResult?.(mutation, result);
        if (mutation.operation !== 'create' && result.serverUpdatedAt) {
          const completedObjectKey = syncObjectKey(mutation.entity, mutation.entityId);
          if (completedObjectKey) {
            for (const queuedMutation of mutations) {
              if (
                queuedMutation.id !== mutation.id
                && syncObjectKey(queuedMutation.entity, queuedMutation.entityId)
                  === completedObjectKey
              ) {
                // getReady returns a snapshot. Keep later mutations in that
                // snapshot chained to the version produced by this success;
                // the store persists the same base for future process runs.
                queuedMutation.baseUpdatedAt = result.serverUpdatedAt;
              }
            }
          }
        }
        await this.store.markCompleted(mutation.id);
        summary.completed += 1;
      } catch (error) {
        const conflict = mapSyncConflict(error, mutation, this.now().toISOString());
        if (conflict) {
          await this.store.markConflict(conflict);
          summary.conflicts += 1;
          continue;
        }

        const attempts = mutation.attempts + 1;
        const baseDelay = Math.min(this.maxRetryDelayMs, 1_000 * 2 ** Math.min(attempts, 10));
        const jitteredDelay = Math.round(baseDelay * (0.75 + this.random() * 0.5));
        const nextAttemptAt = new Date(this.now().getTime() + jitteredDelay).toISOString();
        await this.store.markRetry(
          mutation.id,
          attempts,
          nextAttemptAt,
          errorMessage(error),
        );
        summary.retries += 1;

        // Preserve causal ordering: later mutations in this scope may depend on
        // the failed state even when they have no explicit depends_on edge.
        break;
      }
    }

    return summary;
  }
}
