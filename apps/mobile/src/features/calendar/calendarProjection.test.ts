import { describe, expect, it } from 'vitest';

import type { Bill } from '../../types';
import type { PreviewBill } from '../previewData';
import { expandCalendarOccurrences } from './calendarProjection';

function bill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 1,
    name: 'Rent',
    amount: 1000,
    varies: false,
    frequency: 'monthly',
    frequency_type: 'simple',
    frequency_config: '{}',
    next_due: '2026-07-15',
    auto_payment: false,
    reminder_enabled: true,
    reminder_days: [1],
    icon: 'home',
    type: 'expense',
    account: null,
    category: 'Housing',
    notes: null,
    archived: false,
    is_shared: false,
    ...overrides,
  };
}

function preview(source: Bill): PreviewBill {
  return {
    id: String(source.id),
    name: source.name,
    amount: source.amount ?? 0,
    dueLabel: source.next_due,
    dueDate: source.next_due,
    cadence: source.frequency,
    tone: source.type === 'deposit' ? 'income' : 'expense',
    icon: 'internet',
    category: source.category ?? 'Uncategorized',
    account: source.account ?? 'No account',
    source,
  };
}

describe('calendar recurrence projection', () => {
  it('expands monthly bills across a six-month range', () => {
    const occurrences = expandCalendarOccurrences(
      [preview(bill())],
      new Date(2026, 6, 1),
      new Date(2026, 11, 31, 23, 59, 59),
    );

    expect(occurrences.map((item) => item.dueDate)).toEqual([
      '2026-07-15',
      '2026-08-15',
      '2026-09-15',
      '2026-10-15',
      '2026-11-15',
      '2026-12-15',
    ]);
  });

  it('honors multi-date monthly schedules', () => {
    const occurrences = expandCalendarOccurrences(
      [preview(bill({
        frequency_type: 'specific_dates',
        frequency_config: JSON.stringify({ dates: [1, 15] }),
        next_due: '2026-07-15',
      }))],
      new Date(2026, 6, 1),
      new Date(2026, 7, 31, 23, 59, 59),
    );

    expect(occurrences.map((item) => item.dueDate)).toEqual([
      '2026-07-15',
      '2026-08-01',
      '2026-08-15',
    ]);
  });

  it('projects a one-time bill only on its original due date', () => {
    const occurrences = expandCalendarOccurrences(
      [preview(bill({ frequency: 'once' }))],
      new Date(2026, 6, 1),
      new Date(2026, 11, 31, 23, 59, 59),
    );

    expect(occurrences.map((item) => item.dueDate)).toEqual(['2026-07-15']);
  });
});
