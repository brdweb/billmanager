import { describe, expect, it } from 'vitest';

import type { Bill, Payment } from '../types';
import {
  occurrenceDates,
  projectRecurringBills,
  projectionWindow,
  summarizeCashFlowWindow,
} from './cashFlowProjection';

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
    next_due: '2026-10-22',
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

function payment(overrides: Partial<Payment> = {}): Payment {
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

describe('cash-flow windows', () => {
  it('starts 6-month and 12-month windows today and keeps a calendar year inclusive', () => {
    expect(projectionWindow('6m', today)).toEqual({
      start: '2026-10-22',
      end: '2027-04-21',
      recordedPaymentsBeforeToday: false,
    });
    expect(projectionWindow('12m', today)).toEqual({
      start: '2026-10-22',
      end: '2027-10-21',
      recordedPaymentsBeforeToday: false,
    });
    expect(projectionWindow('year', today, 2026)).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
      recordedPaymentsBeforeToday: true,
    });
  });
});

describe('recurring occurrence counts', () => {
  it('counts a monthly bill 6 times in 6 months and 12 times in 12 months', () => {
    const rent = bill();
    const six = projectionWindow('6m', today);
    const twelve = projectionWindow('12m', today);

    expect(occurrenceDates(rent, six.start, six.end)).toEqual([
      '2026-10-22',
      '2026-11-22',
      '2026-12-22',
      '2027-01-22',
      '2027-02-22',
      '2027-03-22',
    ]);
    expect(occurrenceDates(rent, twelve.start, twelve.end)).toEqual([
      '2026-10-22',
      '2026-11-22',
      '2026-12-22',
      '2027-01-22',
      '2027-02-22',
      '2027-03-22',
      '2027-04-22',
      '2027-05-22',
      '2027-06-22',
      '2027-07-22',
      '2027-08-22',
      '2027-09-22',
    ]);
  });

  it('follows the schedule when a month-end due day clamps to a shorter month', () => {
    const dates = occurrenceDates(
      bill({ next_due: '2026-01-31' }),
      '2026-01-31',
      '2026-07-30',
    );

    expect(dates).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-28',
      '2026-04-28',
      '2026-05-28',
      '2026-06-28',
      '2026-07-28',
    ]);
  });

  it('projects weekly, biweekly, quarterly, and yearly cadences inside the window', () => {
    const six = projectionWindow('6m', today);
    const twelve = projectionWindow('12m', today);
    const weekly = occurrenceDates(bill({ frequency: 'weekly', amount: 10 }), six.start, six.end);
    const biweekly = occurrenceDates(bill({ frequency: 'bi-weekly', amount: 20 }), six.start, six.end);
    const quarterly = occurrenceDates(bill({ frequency: 'quarterly' }), twelve.start, twelve.end);
    const yearly = occurrenceDates(bill({ frequency: 'yearly', next_due: '2026-12-01' }), six.start, six.end);

    expect(weekly).toHaveLength(26);
    expect(weekly[0]).toBe('2026-10-22');
    expect(weekly.at(-1)).toBe('2027-04-15');
    expect(biweekly).toHaveLength(13);
    expect(biweekly.at(-1)).toBe('2027-04-08');
    expect(quarterly).toEqual(['2026-10-22', '2027-01-22', '2027-04-22', '2027-07-22']);
    expect(yearly).toEqual(['2026-12-01']);
    expect(occurrenceDates(
      bill({ frequency: 'yearly', next_due: '2027-05-01' }),
      six.start,
      six.end,
    )).toEqual([]);
    expect(occurrenceDates(
      bill({ frequency: 'yearly', next_due: '2027-05-01' }),
      twelve.start,
      twelve.end,
    )).toEqual(['2027-05-01']);
  });

  it('honors specific monthly dates and multiple weekdays', () => {
    const six = projectionWindow('6m', today);
    expect(occurrenceDates(bill({
      next_due: '2026-11-01',
      frequency_type: 'specific_dates',
      frequency_config: JSON.stringify({ dates: [1, 15] }),
    }), six.start, six.end)).toEqual([
      '2026-11-01',
      '2026-11-15',
      '2026-12-01',
      '2026-12-15',
      '2027-01-01',
      '2027-01-15',
      '2027-02-01',
      '2027-02-15',
      '2027-03-01',
      '2027-03-15',
      '2027-04-01',
      '2027-04-15',
    ]);

    expect(occurrenceDates(bill({
      frequency: 'custom',
      frequency_type: 'multiple_weekly',
      frequency_config: JSON.stringify({ days: [0, 3] }),
    }), '2026-10-22', '2026-11-04')).toEqual([
      '2026-10-22',
      '2026-10-26',
      '2026-10-29',
      '2026-11-02',
    ]);
  });

  it('counts a one-time bill once and skips archived bills', () => {
    const six = projectionWindow('6m', today);
    expect(occurrenceDates(bill({ frequency: 'once' }), six.start, six.end)).toEqual(['2026-10-22']);
    expect(occurrenceDates(bill({ frequency: 'once', next_due: '2026-10-21' }), six.start, six.end)).toEqual([]);
    expect(occurrenceDates(bill({ archived: true }), six.start, six.end)).toEqual([]);
  });
});

describe('window totals', () => {
  it('changes income, bills, and net when the range changes and separates deposits from expenses', () => {
    const bills = [
      bill({ id: 1, amount: 1000, type: 'expense' }),
      bill({ id: 2, name: 'Salary', amount: 2500, type: 'deposit', category: 'Income' }),
    ];
    const six = summarizeCashFlowWindow({ bills, payments: [], range: '6m', today });
    const twelve = summarizeCashFlowWindow({ bills, payments: [], range: '12m', today });

    expect(six.expenses).toBe(6000);
    expect(six.income).toBe(15000);
    expect(six.net).toBe(9000);
    expect(twelve.expenses).toBe(12000);
    expect(twelve.income).toBe(30000);
    expect(twelve.net).toBe(18000);
    expect(six.forecast.at(-1)).toBe(six.net);
    expect(twelve.forecast.at(-1)).toBe(twelve.net);
    expect(six.net).not.toBe(twelve.net);
  });

  it('uses the shared portion and the average amount for variable bills', () => {
    const six = summarizeCashFlowWindow({
      bills: [
        bill({
          amount: 100,
          is_shared: true,
          share_info: {
            share_id: 4,
            owner_name: 'Ada',
            my_portion: 40,
            my_portion_paid: false,
            my_portion_paid_date: null,
          },
        }),
        bill({
          id: 2,
          amount: null,
          varies: true,
          avg_amount: 25,
          type: 'deposit',
        }),
      ],
      payments: [],
      range: '6m',
      today,
    });

    expect(six.expenses).toBe(240);
    expect(six.income).toBe(150);
  });

  it('uses recorded payments before today and the schedule from today for the calendar year', () => {
    const snapshot = summarizeCashFlowWindow({
      bills: [bill({ amount: 10 })],
      payments: [
        payment({ id: 1, amount: 40, payment_date: '2026-03-02' }),
        payment({ id: 2, amount: 15, payment_date: '2026-10-01' }),
        payment({ id: 3, amount: 7, payment_date: '2026-10-21' }),
        payment({ id: 4, amount: 999, payment_date: '2026-10-22' }),
      ],
      range: 'year',
      today,
      year: 2026,
    });

    expect(snapshot.expenses).toBe(92);
    expect(snapshot.income).toBe(0);
    expect(snapshot.net).toBe(-92);
    expect(snapshot.forecast.at(-1)).toBe(-92);
    expect(snapshot.events.filter((event) => event.forecast).map((event) => event.date)).toEqual([
      '2026-10-22',
      '2026-11-22',
      '2026-12-22',
    ]);
  });
});

describe('recurrence-aware analytics forecast', () => {
  it('projects expenses and deposits into each future month in range', () => {
    const projected = projectRecurringBills(
      [
        bill({ id: 1, amount: 1000, type: 'expense', next_due: '2026-08-15' }),
        bill({ id: 2, amount: 2500, type: 'deposit', next_due: '2026-08-30' }),
      ],
      new Date(2026, 7, 1),
      new Date(2026, 9, 31, 23, 59),
    );

    expect(projected.get('2026-08')).toEqual({ income: 2500, expenses: 1000 });
    expect(projected.get('2026-09')).toEqual({ income: 2500, expenses: 1000 });
    expect(projected.get('2026-10')).toEqual({ income: 2500, expenses: 1000 });
  });

  it('ignores archived bills', () => {
    const projected = projectRecurringBills(
      [bill({ archived: true, next_due: '2026-08-15' })],
      new Date(2026, 7, 1),
      new Date(2026, 8, 30),
    );
    expect(projected.size).toBe(0);
  });

  it('projects a one-time bill only in its due month', () => {
    const projected = projectRecurringBills(
      [bill({ frequency: 'once', amount: 400, next_due: '2026-08-15' })],
      new Date(2026, 7, 1),
      new Date(2026, 9, 31, 23, 59),
    );

    expect(projected.get('2026-08')).toEqual({ income: 0, expenses: 400 });
    expect(projected.has('2026-09')).toBe(false);
    expect(projected.has('2026-10')).toBe(false);
  });
});
