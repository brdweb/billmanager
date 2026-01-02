/**
 * Parse a YYYY-MM-DD date string as a local date.
 *
 * JavaScript's `new Date("2024-01-15")` parses ISO date strings as UTC midnight,
 * which causes dates to appear as the previous day for users in timezones west of UTC.
 *
 * This function parses the date string as local midnight instead.
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format a YYYY-MM-DD date string for display.
 * Uses local date parsing to avoid timezone shifts.
 */
export function formatDateString(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a Date object as YYYY-MM-DD using local timezone.
 *
 * Unlike `date.toISOString().split('T')[0]` which uses UTC,
 * this preserves the local date the user selected.
 */
export function formatDateForAPI(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
