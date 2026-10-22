import { describe, expect, it } from 'vitest';

import type { Bill, Payment } from '../../types';
import { buildAnalyticsModel } from './analyticsMath';

const today = new Date(2026, 9, 22);

function bill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 1,
    name: 'Rent',
    amount: 100,
    varies: false,
    frequency: 'monthly',
    frequency_type: 'simple',
    frequency_config: '{}',
    next_due: '2026-11-15',
    auto_payment: false,
    icon: 'home',
    type: 'expense',
    account: 'Checking',
    category: 'Housing',
    notes: null,
    archived: false,
    is_shared: false,
    ...overrides,
  };
}

function payment(overrides: Partial<Payment>): Payment {
  return {
    id: 1,
    bill_id: 1,
    amount: 40,
    payment_date: '2026-03-02',
    notes: null,
    bill_type: 'expense',
    ...overrides,
  };
}

function model(overrides: Partial<Parameters<typeof buildAnalyticsModel>[0]> = {}) {
  return buildAnalyticsModel({
    bills: [bill()],
    payments: [],
    range: '6m',
    year: 2026,
    today,
    locale: 'en-US',
    uncategorizedLabel: 'Uncategorized',
    noAccountLabel: 'No account',
    ...overrides,
  });
}

describe('analytics range math', () => {
  it('uses the next 6 and 12 months from today instead of the back half of the year', () => {
    const six = model({ range: '6m' });
    const twelve = model({ range: '12m' });

    expect(six.monthly.map((point) => point.key)).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
    ]);
    expect(six.monthly.find((point) => point.key === '2026-07')).toBeUndefined();
    expect(six.annual.expenses).toBe(600);
    expect(twelve.annual.expenses).toBe(1200);
    expect(six.categories).toEqual([
      expect.objectContaining({ label: 'Housing', amount: 600, sharePercent: 100 }),
    ]);
    expect(twelve.categories[0]?.amount).toBe(1200);
    expect(six.accounts[0]).toEqual(expect.objectContaining({ label: 'Checking', amount: 600 }));
    expect(six.cashFlow[0]?.openingBalance).toBe(0);
    expect(six.cashFlow.at(-1)?.endingBalance).toBe(six.annual.net);
    expect(six.cashFlow.every((point) => point.forecast)).toBe(true);
    expect(six.monthly.map((point) => point.net)).toEqual(six.cashFlow.map((point) => point.income - point.expenses));
  });

  it('keeps yearly history on recorded payments while the summary follows the range', () => {
    const payments = [
      payment({ id: 1, amount: 80, payment_date: '2025-05-01' }),
      payment({ id: 2, amount: 20, payment_date: '2026-01-10', bill_type: 'deposit' }),
    ];
    const six = model({ payments, range: '6m' });
    const twelve = model({ payments, range: '12m' });

    expect(six.yearly).toEqual(twelve.yearly);
    expect(six.yearOverYear).toEqual(twelve.yearOverYear);
    expect(six.yearly.map((point) => point.year)).toEqual([2024, 2025, 2026]);
    expect(six.yearly.find((point) => point.year === 2025)?.expenses).toBe(80);
    expect(six.annual.expenses).not.toBe(twelve.annual.expenses);
    expect(six.annual.income).toBe(0);
  });

  it('mixes recorded payments and the schedule in the current calendar year', () => {
    const current = model({
      range: 'year',
      bills: [bill({ amount: 10, next_due: '2026-10-22', category: null, account: null })],
      payments: [
        payment({ id: 1, amount: 40, payment_date: '2026-03-02' }),
        payment({ id: 2, amount: 15, payment_date: '2026-10-01' }),
        payment({ id: 3, amount: 7, payment_date: '2026-10-21' }),
        payment({ id: 4, amount: 999, payment_date: '2026-10-22' }),
      ],
    });
    const march = current.monthly.find((point) => point.key === '2026-03');
    const october = current.monthly.find((point) => point.key === '2026-10');
    const cashMarch = current.cashFlow.find((point) => point.key === '2026-03');
    const cashOctober = current.cashFlow.find((point) => point.key === '2026-10');

    expect(current.annual.expenses).toBe(92);
    expect(current.annual.net).toBe(-92);
    expect(march).toEqual(expect.objectContaining({ expenses: 40, income: 0, net: -40 }));
    expect(october).toEqual(expect.objectContaining({ expenses: 32, income: 0, net: -32 }));
    expect(cashMarch?.forecast).toBe(false);
    expect(cashOctober?.forecast).toBe(true);
    expect(current.cashFlow[0]?.openingBalance).toBe(0);
    expect(current.cashFlow.at(-1)?.endingBalance).toBe(-92);
    expect(current.categories[0]).toEqual(expect.objectContaining({ label: 'Uncategorized', amount: 92 }));
    expect(current.accounts[0]).toEqual(expect.objectContaining({ label: 'No account', amount: 92 }));
  });

  it('does not project a past year and does project a future year', () => {
    const bills = [bill({ amount: 10, next_due: '2026-10-22' })];
    const past = model({
      range: 'year',
      year: 2025,
      bills,
      payments: [payment({ amount: 80, payment_date: '2025-05-01' })],
    });
    const future = model({ range: 'year', year: 2027, bills, payments: [] });

    expect(past.annual.expenses).toBe(80);
    expect(past.monthly).toHaveLength(12);
    expect(past.cashFlow.every((point) => !point.forecast)).toBe(true);
    expect(future.annual.expenses).toBe(120);
    expect(future.cashFlow.every((point) => point.forecast)).toBe(true);
  });

  it('keeps deposits out of expense breakdowns', () => {
    const result = model({
      bills: [
        bill({ id: 1, amount: 100, type: 'expense', category: 'Housing' }),
        bill({ id: 2, amount: 2500, type: 'deposit', category: 'Income', next_due: '2026-10-22' }),
      ],
    });

    expect(result.annual.income).toBe(15000);
    expect(result.annual.expenses).toBe(600);
    expect(result.annual.savingsRate).toBe(96);
    expect(result.categories.map((item) => item.label)).toEqual(['Housing']);
    expect(result.accounts.map((item) => item.label)).not.toContain('Income');
  });
});
