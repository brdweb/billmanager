import { nextOccurrence } from '../native/reminderSchedule';
import type { Bill } from '../types';

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9);
  return Number.isNaN(date.getTime()) ? null : date;
}

function serializeDateOnly(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Mirrors the server-side bill lifecycle while a payment is waiting to sync.
 * One-time bills are always archived after payment; recurring bills only move
 * their due date when the caller requested advancement.
 */
export function optimisticBillAfterPayment(bill: Bill, advanceDue: boolean): Bill | null {
  if (bill.frequency.toLowerCase() === 'once') {
    return { ...bill, archived: true };
  }
  if (!advanceDue) return null;

  const current = parseDateOnly(bill.next_due);
  if (!current) return null;
  const next = nextOccurrence(bill, current);
  if (!next) return null;
  return { ...bill, next_due: serializeDateOnly(next) };
}
