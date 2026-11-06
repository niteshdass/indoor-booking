const pad = (n: number) => String(n).padStart(2, '0');

/** Today on the device's clock as YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "Sat, 14 Nov 2026" for a calendar date (read as UTC so the day never shifts). */
export function formatDay(date: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** "14 Nov 2026" or "14 Nov – 2 Dec 2026" for a closure's whole-day range. */
export function formatRange(from: string, to: string, lang: string): string {
  const f = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const a = f.format(new Date(`${from}T00:00:00Z`));
  return from === to ? a : `${a} – ${f.format(new Date(`${to}T00:00:00Z`))}`;
}

/** The calendar month a YYYY-MM-DD date falls in, as YYYY-MM. */
export const monthOf = (date: string): string => date.slice(0, 7);

/** The month before or after a YYYY-MM month. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/**
 * A month as calendar weeks, Monday first: every day as YYYY-MM-DD, with null for the blanks before the 1st and
 * after the last day.
 */
export function monthWeeks(month: string): (string | null)[][] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** "November 2026" in the reader's language. */
export function formatMonth(month: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
}

/** Short weekday names, Monday first. */
export function weekdayNames(lang: string): string[] {
  const f = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2024, 0, 1 + i))));
}
