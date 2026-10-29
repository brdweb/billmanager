import type { SettlementLedgerItem, SettlementsResponse } from '../../types';

type Occurrence = Pick<SettlementLedgerItem, 'share_id' | 'due_date' | 'share_updated_at'>;
export interface SettlementIntent { mutationId: string; baseUpdatedAt: string; expectedDueDate: string }
export function hasSettlementPreconditions(item: Occurrence): boolean {
  if (typeof item.share_updated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(item.share_updated_at)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.due_date)) return false;
  const date = new Date(`${item.due_date}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === item.due_date;
}
interface Attempt extends SettlementIntent { scope: string; occurrence: string; confirmed: boolean; conflicted: boolean }
const occurrenceKey = (item: Occurrence) => JSON.stringify([item.share_id, item.due_date]);

/** Pending retry identities survive uncertain responses; definite paid states retire them. */
export class SettlementAttemptLedger {
  private attempts = new Map<string, Attempt>();
  revision = 0;

  beginAction(): void { this.revision += 1; }
  finishDispatches(): void { this.revision += 1; }

  private key(scope: string, item: Occurrence): string { return JSON.stringify([scope, occurrenceKey(item)]); }

  intent(scope: string, item: Occurrence, createId: () => string): SettlementIntent | null {
    if (!hasSettlementPreconditions(item)) return null;
    const key = this.key(scope, item);
    let attempt = this.attempts.get(key);
    if (!attempt) {
      attempt = { scope, occurrence: occurrenceKey(item), mutationId: createId(), confirmed: false, conflicted: false,
        baseUpdatedAt: item.share_updated_at!, expectedDueDate: item.due_date };
      this.attempts.set(key, attempt);
    }
    return attempt.conflicted ? null : { mutationId: attempt.mutationId, baseUpdatedAt: attempt.baseUpdatedAt, expectedDueDate: attempt.expectedDueDate };
  }

  isConfirmed(scope: string, item: Occurrence): boolean {
    return this.attempts.get(this.key(scope, item))?.confirmed ?? false;
  }

  isConflicted(scope: string, item: Occurrence): boolean {
    return this.attempts.get(this.key(scope, item))?.conflicted ?? false;
  }

  conflict(scope: string, item: Occurrence): void {
    const attempt = this.attempts.get(this.key(scope, item));
    if (attempt) attempt.conflicted = true;
    this.revision += 1;
  }

  confirm(scope: string, item: Occurrence): void {
    const attempt = this.attempts.get(this.key(scope, item));
    if (attempt) attempt.confirmed = true;
    this.revision += 1;
  }

  reconcile(scope: string, snapshot: SettlementsResponse, readRevision?: number): void {
    if (readRevision !== undefined && readRevision !== this.revision) return;
    const paid = new Set(snapshot.settled.filter((item) => item.direction === 'i_owe').map(occurrenceKey));
    for (const [key, attempt] of this.attempts) {
      if (attempt.scope !== scope) continue;
      // A causal fresh read supersedes local success suppression, including a
      // share reopened before the read. An uncertain retry keeps its UUID until
      // the server explicitly reports that occurrence paid.
      if (attempt.conflicted || attempt.confirmed || paid.has(attempt.occurrence)) {
        this.attempts.delete(key);
        this.revision += 1;
      }
    }
  }
}
