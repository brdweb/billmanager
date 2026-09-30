import { describe, expect, it } from 'vitest';
import en from '../../i18n/locales/en.json';
import de from '../../i18n/locales/de.json';
import { proPlans } from './pricing';

describe('Pro purchase catalog', () => {
  it('offers only the approved monthly and annual Pro prices', () => {
    const plans = proPlans((key) => key, 'free');
    expect(plans.map(({ id, amount, currency }) => ({ id, amount, currency }))).toEqual([
      { id: 'pro-month', amount: 2.99, currency: 'USD' },
      { id: 'pro-year', amount: 24, currency: 'USD' },
    ]);
    expect(plans.some((plan) => plan.current)).toBe(false);
  });
  it.each(['pro', 'basic', 'plus'])('recognizes %s annual subscriptions as the current Pro plan', (tier) => {
    const plans = proPlans((key) => key, tier, 'annual');
    expect(plans.map((plan) => plan.current)).toEqual([false, true]);
  });
  it.each([en, de])('localizes all approved benefits and the 30-day trial', (catalog) => {
    const translate = (key: string) => {
      const field = key.replace('billingPage.', '') as keyof typeof catalog.billingPage;
      return catalog.billingPage[field] ?? key;
    };
    const plans = proPlans(translate, 'free');
    expect(plans[0].name).toBe('Pro');
    expect(plans[0].features).toHaveLength(5);
    expect(plans[0].features.some((feature) => feature.includes('6'))).toBe(true);
    expect(plans[0].features.some((feature) => feature.includes('3'))).toBe(true);
    expect(plans[0].features.some((feature) => feature.includes('billingPage.'))).toBe(false);
    expect(catalog.billingPage.trialFooter).toContain('30');
    expect(catalog.billingPage.trialFooter).not.toContain('14');
  });
});
