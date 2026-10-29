import type { FeatureLoadStatus } from '../payments/models';

export type BillingDeploymentMode = 'saas' | 'self_hosted';
export type SubscriptionState = 'trialing' | 'active' | 'past_due' | 'canceled' | 'free' | 'unlimited';
export type BillingInterval = 'month' | 'year';

export interface BillingPlanItem {
  id: string;
  name: string;
  description: string;
  amount: number;
  interval: BillingInterval;
  currency: string;
  features: string[];
  current: boolean;
  recommended?: boolean;
}

export interface BillingUsageItem {
  id: string;
  label: string;
  used: number;
  limit: number | null;
  unitLabel: string;
}

export interface BillingSubscription {
  state: SubscriptionState;
  planName: string;
  renewalLabel?: string;
  cancelAtLabel?: string;
  trialEndsLabel?: string;
  trialDaysRemaining?: number;
}

export interface BillingViewModel {
  status: FeatureLoadStatus;
  errorMessage?: string;
  permissionMessage?: string;
  offline: boolean;
  lastUpdatedLabel?: string;
  deploymentMode: BillingDeploymentMode;
  locale: string;
  currency: string;
  subscription: BillingSubscription;
  usage: BillingUsageItem[];
  plans: BillingPlanItem[];
  canManageBilling: boolean;
  actionBusy?: boolean;
  refreshing?: boolean;
}

export interface BillingActions {
  onSelectPlan: (planId: string) => void;
  onOpenPortal: () => void;
  onRefresh: () => void;
  onRetry: () => void;
}

export function usagePercent(usage: Pick<BillingUsageItem, 'used' | 'limit'>): number | null {
  if (usage.limit === null || usage.limit <= 0) return null;
  return Math.max(0, Math.min(100, (usage.used / usage.limit) * 100));
}

export function planPriceLabel(plan: Pick<BillingPlanItem, 'amount' | 'currency' | 'interval'>, locale = 'en-US'): string {
  if (plan.amount === 0) return 'Free';
  return `${new Intl.NumberFormat(locale, { style: 'currency', currency: plan.currency }).format(plan.amount)}/${plan.interval === 'month' ? 'month' : 'year'}`;
}

export function subscriptionStateLabel(state: SubscriptionState): string {
  const labels: Record<SubscriptionState, string> = {
    trialing: 'Trial',
    active: 'Active',
    past_due: 'Payment due',
    canceled: 'Canceled',
    free: 'Free',
    unlimited: 'Self-hosted unlimited',
  };
  return labels[state];
}
