import type { SettlementLedgerItem, SettlementsResponse } from '../../types';

type Occurrence = Pick<SettlementLedgerItem, 'share_id' | 'due_date'>;
interface Attempt { scope: string; occurrence: string; mutationId: string; confirmed: boolean }
const occurrenceKey = (item: Occurrence) => JSON.stringify([item.share_id, item.due_date]);

/** Pending retry identities survive uncertain responses; definite paid states retire them. */
export class SettlementAttemptLedger {
  private attempts = new Map<string, Attempt>();
  revision = 0;

  beginAction(): void { this.revision += 1; }
  finishDispatches(): void { this.revision += 1; }

  private key(scope: string, item: Occurrence): string { return JSON.stringify([scope, occurrenceKey(item)]); }

  mutationId(scope: string, item: Occurrence, createId: () => string): string {
    const key = this.key(scope, item);
    let attempt = this.attempts.get(key);
    if (!attempt) {
      attempt = { scope, occurrence: occurrenceKey(item), mutationId: createId(), confirmed: false };
      this.attempts.set(key, attempt);
    }
    return attempt.mutationId;
  }

  isConfirmed(scope: string, item: Occurrence): boolean {
    return this.attempts.get(this.key(scope, item))?.confirmed ?? false;
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
      if (attempt.confirmed || paid.has(attempt.occurrence)) {
        this.attempts.delete(key);
        this.revision += 1;
      }
    }
  }
}
