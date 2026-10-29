import type { FeatureLoadStatus } from '../payments/models';

export type SettlementDirection = 'owes-you' | 'you-owe' | 'settled';

export interface SettlementPersonRollup {
  userId: string;
  displayName: string;
  email?: string;
  balance: number;
  direction: SettlementDirection;
  sharedBillCount: number;
  lastActivityLabel: string;
  pendingSync?: boolean;
}

export interface SettlementHistoryItem {
  id: string;
  payerName: string;
  payeeName: string;
  amount: number;
  settledAt: string;
  settledAtLabel: string;
}

export interface SettlementSummary {
  owedToYou: number;
  youOwe: number;
  net: number;
  outstandingPeople: number;
}

export interface SettlementsViewModel {
  status: FeatureLoadStatus;
  errorMessage?: string;
  permissionMessage?: string;
  offline: boolean;
  lastUpdatedLabel?: string;
  locale: string;
  currency: string;
  bucketLabel: string;
  summary: SettlementSummary;
  people: SettlementPersonRollup[];
  recentHistory: SettlementHistoryItem[];
  refreshing?: boolean;
  actionBusy?: boolean;
}

export interface SettlementsActions {
  onOpenPerson: (userId: string) => void;
  onMarkPaid: (userId: string) => void;
  onOpenHistory: () => void;
  onRefresh: () => void;
  onRetry: () => void;
}

export function deriveSettlementSummary(
  people: Pick<SettlementPersonRollup, 'balance' | 'direction'>[],
): SettlementSummary {
  return people.reduce<SettlementSummary>((summary, person) => {
    const balance = Math.abs(person.balance);
    if (person.direction === 'owes-you') {
      summary.owedToYou += balance;
      summary.net += balance;
      summary.outstandingPeople += 1;
    } else if (person.direction === 'you-owe') {
      summary.youOwe += balance;
      summary.net -= balance;
      summary.outstandingPeople += 1;
    }
    return summary;
  }, { owedToYou: 0, youOwe: 0, net: 0, outstandingPeople: 0 });
}
