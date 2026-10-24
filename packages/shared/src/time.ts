import { WEEKDAYS, type Weekday } from './venues';

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function parseDate(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return [y, m, d];
}

export function weekdayOf(date: string): Weekday {
  const [y, m, d] = parseDate(date);
  // getUTCDay: 0 = Sunday; WEEKDAYS starts on Monday
  return WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7]!;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function hmToMin(hm: string): number {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** A range whose end is at or before its start ends the next day (equal = 24 h). */
export function rangeMinutes(r: { start: string; end: string }): [number, number] {
  const s = hmToMin(r.start);
  const e = hmToMin(r.end);
  return [s, e <= s ? e + 1440 : e];
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Wall-clock fields of an instant in tz. */
function wallParts(ms: number, tz: string) {
  const p: Record<string, number> = {};
  for (const { type, value } of formatterFor(tz).formatToParts(new Date(ms))) {
    if (type !== 'literal') p[type] = Number(value);
  }
  return p as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

/** Local wall time minus UTC, in minutes. */
function offsetMin(tz: string, ms: number): number {
  const p = wallParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MIN_MS);
}

/**
 * Local wall time to UTC. minuteOfDay may be >= 1440. A repeated time takes the earlier
 * instant; a skipped time moves forward by the gap. Assumes transitions are >= 48 h apart.
 */
export function localToUtc(date: string, minuteOfDay: number, tz: string): Date {
  const [y, m, d] = parseDate(date);
  const wall = Date.UTC(y, m - 1, d) + minuteOfDay * MIN_MS;
  const before = offsetMin(tz, wall - DAY_MS);
  const after = offsetMin(tz, wall + DAY_MS);
  const fits = [...new Set([before, after])]
    .map((o) => wall - o * MIN_MS)
    .filter((t) => t + offsetMin(tz, t) * MIN_MS === wall);
  if (fits.length) return new Date(Math.min(...fits));
  return new Date(wall - before * MIN_MS);
}

export function localParts(at: Date, tz: string): { date: string; hm: string } {
  const p = wallParts(at.getTime(), tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${String(p.year).padStart(4, '0')}-${pad(p.month)}-${pad(p.day)}`, hm: `${pad(p.hour)}:${pad(p.minute)}` };
}
