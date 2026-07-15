import { describe, expect, it } from 'vitest';

import type { Bill } from '../types';
import { buildReminderSchedule, nextOccurrence } from './reminderSchedule';

const bill: Bill = {
  id: 7,
  name: 'Electric',
  amount: 142.18,
  varies: false,
  frequency: 'monthly',
  frequency_type: 'simple',
  frequency_config: '{}',
  next_due: '2026-07-15',
  auto_payment: false,
  reminder_enabled: true,
  reminder_days: [0, 3],
  icon: 'zap',
  type: 'expense',
  account: null,
  category: null,
  notes: null,
  archived: false,
  is_shared: false,
};

describe('local reminder scheduling', () => {
  it('creates a rolling schedule without remote push tokens', () => {
    const reminders = buildReminderSchedule(bill ? [bill] : [], new Date(2026, 6, 10, 10), 60);
    expect(reminders.map((item) => item.dueDate)).toContain('2026-07-15');
    expect(reminders.map((item) => item.dueDate)).toContain('2026-08-15');
    expect(new Set(reminders.map((item) => item.id)).size).toBe(reminders.length);
  });

  it('clamps recurring dates at month boundaries', () => {
    const january31 = new Date(2027, 0, 31, 9);
    expect(nextOccurrence(bill, january31)?.getDate()).toBe(28);
  });

  it('schedules a one-time bill only for its original due date', () => {
    const oneTimeBill = { ...bill, frequency: 'once' as const };
    const reminders = buildReminderSchedule([oneTimeBill], new Date(2026, 6, 10, 10), 60);

    expect([...new Set(reminders.map((item) => item.dueDate))]).toEqual(['2026-07-15']);
    expect(nextOccurrence(oneTimeBill, new Date(2026, 6, 15, 9))).toBeNull();
  });

  it('does not schedule archived or disabled bills', () => {
    expect(buildReminderSchedule([{ ...bill, archived: true }], new Date(2026, 6, 10))).toEqual([]);
    expect(buildReminderSchedule([{ ...bill, reminder_enabled: false }], new Date(2026, 6, 10))).toEqual([]);
  });
});
