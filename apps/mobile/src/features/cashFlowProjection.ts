import { addMonths } from 'date-fns';

import { nextOccurrence } from '../native/reminderSchedule';
import type { Bill, Payment } from '../types';

/**
 * Insight and analytics windows:
 * - `6m` and `12m` are the next 6 or 12 months starting today. The interval is
 *   half-open: [today, today + N months). Every scheduled occurrence in that
 *   window counts. Recorded payments are not mixed in, because none of the
 *   window is in the past.
 * - `year` is a calendar year. Dates before today use recorded payments.
 *   Today through December 31 uses the schedule, so a payment already recorded
 *   today is not added on top of today's occurrence.
 * The Bill model has no end-date or remaining-payment field. A series stops
 * when the next date falls outside the window, the next date does not advance,
 * or the frequency is `once` (a single date).
 */
export type CashFlowRange = '6m' | '12m' | 'year';

export interface ProjectionWindow {
  /** Inclusive YYYY-MM-DD. */
  start: string;
  /** Inclusive YYYY-MM-DD. The following day is the exclusive end. */
  end: string;
  recordedPaymentsBeforeToday: boolean;
}

export interface CashFlowEvent {
  date: string;
  income: number;
  expenses: number;
  category: string | null;
  account: string | null;
  forecast: boolean;
}

export interface WindowSnapshot {
  window: ProjectionWindow;
  income: number;
  expenses: number;
  net: number;
  /** Running balance starting at zero. The last point is the ending balance. */
  forecast: number[];
  events: CashFlowEvent[];
}

const OCCURRENCE_GUARD = 2048;

export function calendarDateKey(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function dateKey(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function parseDue(value: string): Date | null {
  const key = calendarDateKey(value);
  if (!key) return null;
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 9, 0, 0, 0);
}

function dayBefore(value: Date): string {
  const last = new Date(value.getFullYear(), value.getMonth(), value.getDate() - 1);
  return dateKey(last);
}

export function projectionWindow(range: CashFlowRange, today: Date, year = today.getFullYear()): ProjectionWindow {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (range === '6m' || range === '12m') {
    const months = range === '6m' ? 6 : 12;
    return {
      start: dateKey(start),
      end: dayBefore(addMonths(start, months)),
      recordedPaymentsBeforeToday: false,
    };
  }
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    recordedPaymentsBeforeToday: true,
  };
}

export function occurrenceAmount(bill: Bill): number {
  const portion = bill.share_info?.my_portion;
  if (bill.is_shared && typeof portion === 'number') return portion;
  return bill.amount ?? bill.avg_amount ?? 0;
}

export function occurrenceDates(bill: Bill, start: string, end: string): string[] {
  if (bill.archived || start > end) return [];
  let occurrence = parseDue(bill.next_due);
  if (!occurrence) return [];

  const dates: string[] = [];
  let guard = 0;
  while (guard < OCCURRENCE_GUARD) {
    const key = dateKey(occurrence);
    if (key > end) break;
    if (key >= start) dates.push(key);
    const next = nextOccurrence(bill, occurrence);
    if (!next || next.getTime() <= occurrence.getTime()) break;
    occurrence = next;
    guard += 1;
  }
  return dates;
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function projectRecurringBills(bills: Bill[], start: Date, end: Date) {
  const projected = new Map<string, { income: number; expenses: number }>();
  const startKey = dateKey(start);
  const endKey = dateKey(end);
  bills.forEach((bill) => {
    const amount = occurrenceAmount(bill);
    occurrenceDates(bill, startKey, endKey).forEach((date) => {
      const key = monthKey(date);
      const point = projected.get(key) ?? { income: 0, expenses: 0 };
      if (bill.type === 'deposit') point.income += amount;
      else point.expenses += amount;
      projected.set(key, point);
    });
  });
  return projected;
}

function paymentDirection(payment: Payment, bill: Bill | undefined): 'deposit' | 'expense' {
  const direction = payment.bill_type ?? payment.original_bill_type ?? bill?.type;
  return direction === 'deposit' || payment.is_received_payment ? 'deposit' : 'expense';
}

export function summarizeCashFlowWindow(input: {
  bills: Bill[];
  payments: Payment[];
  range: CashFlowRange;
  today: Date;
  year?: number;
}): WindowSnapshot {
  const window = projectionWindow(input.range, input.today, input.year);
  const todayKey = dateKey(new Date(input.today.getFullYear(), input.today.getMonth(), input.today.getDate()));
  const billById = new Map(input.bills.map((bill) => [bill.id, bill]));
  const events: CashFlowEvent[] = [];

  if (window.recordedPaymentsBeforeToday) {
    input.payments.forEach((payment) => {
      const date = calendarDateKey(payment.payment_date);
      if (!date || date < window.start || date >= todayKey || date > window.end) return;
      const bill = billById.get(payment.bill_id);
      const deposit = paymentDirection(payment, bill) === 'deposit';
      events.push({
        date,
        income: deposit ? payment.amount : 0,
        expenses: deposit ? 0 : payment.amount,
        category: bill?.category ?? null,
        account: bill?.account ?? null,
        forecast: false,
      });
    });
  }

  const projectionStart = !window.recordedPaymentsBeforeToday || todayKey <= window.start
    ? window.start
    : todayKey;
  if (projectionStart <= window.end) {
    input.bills.forEach((bill) => {
      const amount = occurrenceAmount(bill);
      const deposit = bill.type === 'deposit';
      occurrenceDates(bill, projectionStart, window.end).forEach((date) => {
        events.push({
          date,
          income: deposit ? amount : 0,
          expenses: deposit ? 0 : amount,
          category: bill.category,
          account: bill.account,
          forecast: true,
        });
      });
    });
  }

  events.sort((left, right) => {
    const byDate = left.date.localeCompare(right.date);
    if (byDate !== 0) return byDate;
    if (left.forecast !== right.forecast) return left.forecast ? 1 : -1;
    return right.income - left.income;
  });

  let income = 0;
  let expenses = 0;
  let balance = 0;
  const forecast = [0];
  events.forEach((event) => {
    income += event.income;
    expenses += event.expenses;
    balance += event.income - event.expenses;
    forecast.push(balance);
  });
  if (forecast.length === 1) forecast.push(balance);

  return {
    window,
    income,
    expenses,
    net: income - expenses,
    forecast,
    events,
  };
}
