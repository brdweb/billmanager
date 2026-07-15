import { addDays, addMonths, addWeeks, addYears, isAfter, isBefore } from 'date-fns';

import type { Bill } from '../types';

export interface LocalReminder {
  id: string;
  billId: number;
  billName: string;
  billType: Bill['type'];
  amount: number | null;
  dueDate: string;
  notifyAt: Date;
  daysBefore: number;
}

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function serializeDateOnly(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function parseFrequencyConfig(value: Bill['frequency_config']): Record<string, unknown> {
  if (!value) return {};
  try {
    const result = JSON.parse(value) as unknown;
    return result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function nextOccurrence(bill: Bill, current: Date): Date | null {
  const frequency = bill.frequency.toLowerCase();
  const config = parseFrequencyConfig(bill.frequency_config);

  if (frequency === 'once') return null;
  if (frequency === 'weekly') return addWeeks(current, 1);
  if (frequency === 'biweekly' || frequency === 'bi-weekly') return addWeeks(current, 2);
  if (frequency === 'quarterly') return addMonths(current, 3);
  if (frequency === 'yearly') return addYears(current, 1);

  if (frequency === 'custom' && bill.frequency_type === 'multiple_weekly') {
    const days = Array.isArray(config.days)
      ? config.days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
      : [];
    if (days.length > 0) {
      const currentDay = current.getDay() === 0 ? 6 : current.getDay() - 1;
      const nextDay = days.sort((a, b) => a - b).find((day) => day > currentDay);
      return addDays(current, nextDay == null ? 7 - currentDay + days[0] : nextDay - currentDay);
    }
    return addWeeks(current, 1);
  }

  if (frequency === 'monthly' && bill.frequency_type === 'specific_dates') {
    const dates = Array.isArray(config.dates)
      ? config.dates.filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 31)
      : [];
    const nextDay = dates.sort((a, b) => a - b).find((day) => day > current.getDate());
    if (nextDay != null) {
      const sameMonth = new Date(current);
      sameMonth.setDate(nextDay);
      if (sameMonth.getMonth() === current.getMonth()) return sameMonth;
    }
    if (dates.length > 0) {
      const nextMonth = addMonths(new Date(current.getFullYear(), current.getMonth(), 1, 9), 1);
      const maxDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
      nextMonth.setDate(Math.min(dates[0], maxDay));
      return nextMonth;
    }
  }

  return addMonths(current, 1);
}

export function buildReminderSchedule(
  bills: Bill[],
  now = new Date(),
  horizonDays = 60,
): LocalReminder[] {
  const horizon = addDays(now, horizonDays);
  const reminders: LocalReminder[] = [];

  for (const bill of bills) {
    if (bill.archived || !bill.reminder_enabled) continue;
    const initialDueDate = parseDateOnly(bill.next_due);
    if (!initialDueDate) continue;

    const reminderDays = bill.reminder_days?.length ? bill.reminder_days : [0, 1, 3, 7];
    let dueDate = initialDueDate;
    let occurrenceCount = 0;

    while (!isAfter(dueDate, addDays(horizon, Math.max(...reminderDays, 0))) && occurrenceCount < 128) {
      for (const daysBefore of reminderDays) {
        const scheduled = addDays(dueDate, -daysBefore);
        const notifyAt =
          daysBefore === 0 && serializeDateOnly(dueDate) === serializeDateOnly(now) && isBefore(scheduled, now)
            ? new Date(now.getTime() + 60_000)
            : scheduled;

        if (isAfter(notifyAt, now) && !isAfter(notifyAt, horizon)) {
          const dueDateValue = serializeDateOnly(dueDate);
          reminders.push({
            id: `bill-${bill.id}-${dueDateValue}-${daysBefore}`,
            billId: bill.id,
            billName: bill.name,
            billType: bill.type,
            amount: bill.amount,
            dueDate: dueDateValue,
            notifyAt,
            daysBefore,
          });
        }
      }

      const next = nextOccurrence(bill, dueDate);
      if (!next || !isAfter(next, dueDate)) break;
      dueDate = next;
      occurrenceCount += 1;
    }
  }

  return reminders.sort((left, right) => left.notifyAt.getTime() - right.notifyAt.getTime());
}
