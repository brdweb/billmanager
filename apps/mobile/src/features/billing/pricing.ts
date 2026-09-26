import type { BillingPlanItem } from './models';

export function proPlans(
  translate: (key: string) => string,
  tier: string,
  billingInterval?: string,
): BillingPlanItem[] {
  return (['month', 'year'] as const).map((interval) => ({
    id: `pro-${interval}`,
    name: translate('billingPage.proPlan'),
    description: translate('mobileParity.billing.proDescription'),
    amount: interval === 'month' ? 2.99 : 24,
    interval,
    currency: 'USD',
    features: [1, 2, 3, 4, 5].map((index) => translate(`billingPage.proFeature${index}`)),
    current: ['pro', 'basic', 'plus'].includes(tier)
      && billingInterval === (interval === 'month' ? 'monthly' : 'annual'),
    recommended: interval === 'year',
  }));
}
