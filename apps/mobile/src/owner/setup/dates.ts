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
