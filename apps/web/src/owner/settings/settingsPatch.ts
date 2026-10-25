import { WEEKDAYS, type DayHours, type OwnerSettings, type WeeklyHours } from '@booking/shared';

export type SettingsLevel = 'owner' | 'venue';

/**
 * What the form edits. At venue level an absent key means "inherit from owner"; at owner level the form
 * always fills every key.
 */
export type StoredSettings = Omit<Partial<OwnerSettings>, 'hours'> & { hours?: Partial<WeeklyHours> };
export type Draft = StoredSettings;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Per-day hours diff. A changed day is sent with its value; a day that is in `before` but not in `draft` is
 * sent as `null` (back to inherit) when `allowNull`; unchanged days are left out. Undefined when nothing changed.
 */
export function hoursPatch(
  before: Partial<WeeklyHours>,
  draft: Partial<WeeklyHours>,
  allowNull: boolean,
): Record<string, DayHours | null> | undefined {
  const out: Record<string, DayHours | null> = {};
  for (const day of WEEKDAYS) {
    const was = before[day];
    const now = draft[day];
    if (now === undefined) {
      if (was !== undefined && allowNull) out[day] = null;
    } else if (!same(was, now)) {
      out[day] = now;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const KEYS = ['weekendDays', 'paymentPolicy', 'guestBooking', 'refundRules', 'bookingWindowDays', 'pendingAutoRejectHours'] as const;

/**
 * The PATCH body: only keys that differ from `before`. At venue level a key removed from the draft becomes
 * `null` (inherit). Owner level never sends `null`, and has no per-venue pendingAutoRejectHours inherit.
 */
export function settingsPatch(level: SettingsLevel, before: StoredSettings, draft: Draft): Record<string, unknown> {
  const venue = level === 'venue';
  const out: Record<string, unknown> = {};

  if (draft.hours === undefined) {
    if (venue && before.hours !== undefined) out.hours = null;
  } else {
    const hours = hoursPatch(before.hours ?? {}, draft.hours, venue);
    if (hours) out.hours = hours;
  }

  for (const key of KEYS) {
    if (!venue && key === 'pendingAutoRejectHours' && draft[key] === undefined) continue;
    if (draft[key] === undefined) {
      if (venue && before[key] !== undefined) out[key] = null;
    } else if (!same(before[key], draft[key])) {
      out[key] = draft[key];
    }
  }
  return out;
}

export type SettingsError = 'hours' | 'percent' | 'amount' | 'refund' | 'duplicate' | 'window' | 'autoReject';

const inRange = (n: number | undefined, min: number, max: number) =>
  n !== undefined && Number.isInteger(n) && n >= min && n <= max;

/** Problems the API would reject; empty means the draft can be sent. */
export function settingsErrors(draft: Draft): Set<SettingsError> {
  const e = new Set<SettingsError>();
  const p = draft.paymentPolicy;
  if (p?.type === 'partial_percent' && !(p.percent > 0 && p.percent < 100)) e.add('percent');
  if (p?.type === 'partial_fixed' && !(Number.isInteger(p.amount) && p.amount > 0)) e.add('amount');
  const rules = draft.refundRules;
  if (rules) {
    if (rules.length > 10) e.add('refund');
    if (rules.some((r) => !inRange(r.minHoursBefore, 0, 8760) || !(r.percent >= 0 && r.percent <= 100))) e.add('refund');
    if (new Set(rules.map((r) => r.minHoursBefore)).size !== rules.length) e.add('duplicate');
  }
  if (draft.bookingWindowDays !== undefined && !inRange(draft.bookingWindowDays, 1, 365)) e.add('window');
  if (draft.pendingAutoRejectHours !== undefined && !inRange(draft.pendingAutoRejectHours, 0, 72)) e.add('autoReject');
  const times = Object.values(draft.hours ?? {});
  if (times.some((h) => h !== 'closed' && (!h.open || !h.close))) e.add('hours');
  return e;
}
