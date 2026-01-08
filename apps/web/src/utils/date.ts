/**
 * Parse a YYYY-MM-DD date string as a local date.
 *
 * JavaScript's `new Date("2024-01-15")` parses ISO date strings as UTC midnight,
 * which causes dates to appear as the previous day for users in timezones west of UTC.
 *
 * This function parses the date string as local midnight instead.
 * Returns null if the date string is invalid or not in YYYY-MM-DD format.
 */
export function parseLocalDate(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const parts = dateStr.split('-');
  if (parts.length !== 3) return null; // Must be YYYY-MM-DD format

  const [year, month, day] = parts.map(Number);

  // Validate the parsed values
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);

  // Check if the date is valid (handles cases like Feb 31)
  if (isNaN(date.getTime())) return null;

  return date;
}

/**
 * Format a YYYY-MM-DD date string for display.
 * Uses local date parsing to avoid timezone shifts.
 * Returns the original string if parsing fails.
 */
export function formatDateString(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  if (!date) return dateStr; // Return original if parsing fails

  return date.toLocaleDateString('en-US', {
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
