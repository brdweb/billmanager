import { describe, expect, it } from 'vitest';
import type { Bill } from '../api/client';
import { projectUpcomingBills } from '../utils/upcomingBills';

function bill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 1,
    name: 'Paycheck',
    amount: 2000,
    varies: false,
    frequency: 'bi-weekly',
    frequency_type: 'simple',
    frequency_config: '{}',
    next_due: '2026-08-25',
    auto_payment: false,
    paid: false,
    archived: false,
    icon: 'cash',
    type: 'deposit',
    account: 'Checking',
    created_at: '2026-01-01T00:00:00Z',
    is_shared: false,
    ...overrides,
  };
}

describe('projectUpcomingBills', () => {
  it('shows both biweekly deposits in the next 30 days after payday', () => {
    const projected = projectUpcomingBills(
      [bill()],
      new Date(2026, 7, 26),
      new Date(2026, 8, 25),
    );

    expect(projected.map((item) => item.next_due)).toEqual([
      '2026-09-08',
      '2026-09-22',
    ]);
    expect(projected.every((item) => item.id === 1)).toBe(true);
  });

  it('shows every weekly deposit inside the selected window', () => {
    const projected = projectUpcomingBills(
      [bill({ frequency: 'weekly', next_due: '2026-08-27' })],
      new Date(2026, 7, 26),
      new Date(2026, 8, 16),
    );

    expect(projected.map((item) => item.next_due)).toEqual([
      '2026-08-27',
      '2026-09-03',
      '2026-09-10',
    ]);
  });

  it('shows every recurring expense and excludes out-of-window entries', () => {
    const projected = projectUpcomingBills(
      [
        bill({ id: 2, name: 'Rent', type: 'expense', frequency: 'weekly', next_due: '2026-08-27' }),
        bill({ id: 3, name: 'Old bill', type: 'expense', frequency: 'once', next_due: '2026-08-20' }),
      ],
      new Date(2026, 7, 26),
      new Date(2026, 8, 25),
    );

    expect(projected.map((item) => [item.name, item.next_due])).toEqual([
      ['Rent', '2026-08-27'],
      ['Rent', '2026-09-03'],
      ['Rent', '2026-09-10'],
      ['Rent', '2026-09-17'],
      ['Rent', '2026-09-24'],
    ]);
  });

  it('shows both biweekly bill occurrences in a 30-day window', () => {
    const projected = projectUpcomingBills(
      [bill({ type: 'expense', name: 'Loan payment' })],
      new Date(2026, 7, 26),
      new Date(2026, 8, 25),
    );

    expect(projected.map((item) => item.next_due)).toEqual([
      '2026-09-08',
      '2026-09-22',
    ]);
  });

  it('supports monthly deposits scheduled on multiple dates', () => {
    const projected = projectUpcomingBills(
      [bill({
        frequency: 'monthly',
        frequency_type: 'specific_dates',
        frequency_config: JSON.stringify({ dates: [1, 15] }),
        next_due: '2026-08-15',
      })],
      new Date(2026, 7, 26),
      new Date(2026, 8, 20),
    );

    expect(projected.map((item) => item.next_due)).toEqual([
      '2026-09-01',
      '2026-09-15',
    ]);
  });
});
