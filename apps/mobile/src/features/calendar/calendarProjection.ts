import { nextOccurrence } from '../../native/reminderSchedule';
import type { PreviewBill } from '../previewData';

function dateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function expandCalendarOccurrences(
  bills: PreviewBill[],
  start: Date,
  end: Date,
): PreviewBill[] {
  return bills.flatMap((bill) => {
    if (!bill.dueDate) return [];
    const first = new Date(`${bill.dueDate}T00:00:00`);
    if (Number.isNaN(first.getTime())) return [];
    if (!bill.source) return first >= start && first <= end ? [bill] : [];

    const occurrences: PreviewBill[] = [];
    let occurrence = first;
    let guard = 0;
    while (occurrence <= end && guard < 2048) {
      if (occurrence >= start) {
        occurrences.push({ ...bill, dueDate: dateKey(occurrence) });
      }
      const next = nextOccurrence(bill.source, occurrence);
      if (!next || next <= occurrence) break;
      occurrence = next;
      guard += 1;
    }
    return occurrences;
  });
}
