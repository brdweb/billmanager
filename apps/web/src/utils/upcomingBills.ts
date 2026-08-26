import type { Bill } from '../api/client';

const MAX_PROJECTED_OCCURRENCES = 250;

type FrequencyConfig = {
  dates?: number[];
  days?: number[];
};

function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const targetMonth = date.getMonth() + months;
  const targetYear = date.getFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  return new Date(targetYear, normalizedMonth, Math.min(date.getDate(), lastDay));
}

function parseFrequencyConfig(value: string): FrequencyConfig {
  try {
    const parsed: unknown = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === 'object' ? parsed as FrequencyConfig : {};
  } catch {
    return {};
  }
}

function calculateNextDueDate(current: Date, bill: Bill): Date | null {
  switch (bill.frequency) {
    case 'once':
      return null;
    case 'weekly':
      return addDays(current, 7);
    case 'bi-weekly':
    case 'biweekly':
      return addDays(current, 14);
    case 'monthly': {
      const config = parseFrequencyConfig(bill.frequency_config);
      if (bill.frequency_type === 'specific_dates' && Array.isArray(config.dates)) {
        const dates = [...new Set(config.dates)]
          .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31)
          .sort((a, b) => a - b);
        if (dates.length > 0) {
          const nextDay = dates.find((day) => day > current.getDate());
          const targetMonth = nextDay === undefined ? addMonths(current, 1) : current;
          const requestedDay = nextDay ?? dates[0];
          const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
          return new Date(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(requestedDay, lastDay));
        }
      }
      return addMonths(current, 1);
    }
    case 'quarterly':
      return addMonths(current, 3);
    case 'yearly': {
      const nextYear = current.getFullYear() + 1;
      const lastDay = new Date(nextYear, current.getMonth() + 1, 0).getDate();
      return new Date(nextYear, current.getMonth(), Math.min(current.getDate(), lastDay));
    }
    case 'custom': {
      const config = parseFrequencyConfig(bill.frequency_config);
      if (bill.frequency_type === 'multiple_weekly' && Array.isArray(config.days)) {
        const days = [...new Set(config.days)]
          .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
          .sort((a, b) => a - b);
        if (days.length > 0) {
          const currentWeekday = (current.getDay() + 6) % 7;
          const nextWeekday = days.find((day) => day > currentWeekday);
          const dayOffset = nextWeekday === undefined
            ? 7 - currentWeekday + days[0]
            : nextWeekday - currentWeekday;
          return addDays(current, dayOffset);
        }
      }
      return addDays(current, 30);
    }
    default:
      return addDays(current, 30);
  }
}

/**
 * Return every bill or deposit occurrence in a half-open upcoming window.
 * Projected rows retain the source bill ID so actions continue to operate on
 * the underlying recurring entry.
 */
export function projectUpcomingBills(bills: Bill[], startDate: Date, endDate: Date): Bill[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const projected = bills.flatMap((bill) => {
    let dueDate = parseDate(bill.next_due);
    if (!dueDate) return [];

    let guard = 0;
    while (dueDate < start && guard < MAX_PROJECTED_OCCURRENCES) {
      const nextDue = calculateNextDueDate(dueDate, bill);
      if (!nextDue || nextDue <= dueDate) return [];
      dueDate = nextDue;
      guard += 1;
    }

    const occurrences: Bill[] = [];
    while (dueDate < end && guard < MAX_PROJECTED_OCCURRENCES) {
      occurrences.push({ ...bill, next_due: formatDate(dueDate) });
      const nextDue = calculateNextDueDate(dueDate, bill);
      if (!nextDue || nextDue <= dueDate) break;
      dueDate = nextDue;
      guard += 1;
    }
    return occurrences;
  });

  return projected.sort((a, b) => a.next_due.localeCompare(b.next_due));
}
