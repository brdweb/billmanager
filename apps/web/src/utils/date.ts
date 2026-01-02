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
