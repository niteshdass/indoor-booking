import { priceFor, type TurfPricing } from './pricing';
import type { DayHours } from './settings';
import type { SlotStatus } from './statuses';
import { addDays, hmToMin, localParts, localToUtc, rangeMinutes, weekdayOf } from './time';
import type { Weekday } from './venues';

const MIN_MS = 60_000;

export type OverrideWhen =
  | { date: string }
  | { recurrence: { weekdays: Weekday[]; from: string; until?: string } };

export type OverrideRule =
  | { type: 'block'; start: string; end: string }
  | { type: 'modify'; slotStart: string; start: string; end: string; price?: number }
  | { type: 'add'; start: string; end: string; price?: number }
  | { type: 'close' };

export type SlotOverrideLike = OverrideWhen & OverrideRule;

export type ComputedSlot = {
  startAt: Date;
  endAt: Date;
  localStart: string;
  localEnd: string;
  price: number | null;
  status: SlotStatus;
  source: 'hours' | 'modify' | 'add';
};

export type DaySlots = { businessDate: string; closed: boolean; closedReason: string | null; slots: ComputedSlot[] };

export function overrideAppliesOn(o: OverrideWhen, date: string): boolean {
  if ('date' in o) return o.date === date;
  const { weekdays, from, until } = o.recurrence;
  return date >= from && (until === undefined || date <= until) && weekdays.includes(weekdayOf(date));
}

/** Whether some date has both overrides applying. */
export function overrideDatesIntersect(a: OverrideWhen, b: OverrideWhen): boolean {
  if ('date' in a) return overrideAppliesOn(b, a.date);
  if ('date' in b) return overrideAppliesOn(a, b.date);
  const from = a.recurrence.from > b.recurrence.from ? a.recurrence.from : b.recurrence.from;
  const untils = [a.recurrence.until, b.recurrence.until].filter((u): u is string => u !== undefined);
  const until = untils.length ? untils.sort()[0]! : undefined;
  // Every weekday occurs within 7 consecutive days, so a week of the intersection is enough.
  for (let i = 0, d = from; i < 7 && (until === undefined || d <= until); i++, d = addDays(from, i)) {
    if (overrideAppliesOn(a, d) && overrideAppliesOn(b, d)) return true;
  }
  return false;
}

/** Slot minute ranges of a business day, ignoring DST (used by the overlap check). */
export function generatedRanges(hours: DayHours, slotLengthMin: number): [number, number][] {
  if (hours === 'closed') return [];
  const [open, close] = rangeMinutes({ start: hours.open, end: hours.close });
  const out: [number, number][] = [];
  for (let s = open; s + slotLengthMin <= close; s += slotLengthMin) out.push([s, s + slotLengthMin]);
  return out;
}

type Draft = { startAt: Date; endAt: Date; source: ComputedSlot['source']; price?: number; minute: number };

function rangeUtc(date: string, range: { start: string; end: string }, tz: string) {
  const [s, e] = rangeMinutes(range);
  return { startAt: localToUtc(date, s, tz), endAt: localToUtc(date, e, tz), minute: s };
}

function overlaps(a: { startAt: Date; endAt: Date }, b: { startAt: Date; endAt: Date }): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

export function computeSlots(input: {
  businessDate: string;
  timezone: string;
  hours: DayHours;
  weekend: boolean;
  slotLengthMin: number;
  pricing: TurfPricing | null;
  overrides: (OverrideRule & { reason?: string | null })[];
  closure: { reason: string | null } | null;
  taken?: { startAt: Date; status: 'pending' | 'booked' }[];
  now: Date;
}): DaySlots {
  const { businessDate, timezone: tz, hours, overrides } = input;
  const close = overrides.find((o) => o.type === 'close');
  if (input.closure || close) {
    return { businessDate, closed: true, closedReason: input.closure?.reason ?? close?.reason ?? null, slots: [] };
  }

  // 1. Generated slots, cut by elapsed time so DST nights neither duplicate nor skip a slot.
  const generated: Draft[] = [];
  if (hours !== 'closed') {
    const [openMin, closeMin] = rangeMinutes({ start: hours.open, end: hours.close });
    const start = localToUtc(businessDate, openMin, tz).getTime();
    const end = localToUtc(businessDate, closeMin, tz).getTime();
    const len = input.slotLengthMin * MIN_MS;
    for (let t = start; t + len <= end; t += len) {
      const at = localParts(new Date(t), tz);
      const minute = hmToMin(at.hm) + (at.date !== businessDate ? 1440 : 0);
      generated.push({ startAt: new Date(t), endAt: new Date(t + len), source: 'hours', minute });
    }
  }

  // 2. modify replaces its first matching generated slot; add appends.
  const extra: Draft[] = [];
  for (const o of overrides) {
    if (o.type === 'modify') {
      const i = generated.findIndex((g) => localParts(g.startAt, tz).hm === o.slotStart);
      if (i < 0) continue; // hours changed since the override was made
      generated.splice(i, 1);
      extra.push({ ...rangeUtc(businessDate, o, tz), source: 'modify', price: o.price });
    } else if (o.type === 'add') {
      extra.push({ ...rangeUtc(businessDate, o, tz), source: 'add', price: o.price });
    }
  }

  // 3. Overrides win over any generated slot they overlap.
  const drafts = [...generated.filter((g) => !extra.some((x) => overlaps(g, x))), ...extra].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );

  const blocks = overrides.flatMap((o) => (o.type === 'block' ? [rangeUtc(businessDate, o, tz)] : []));
  const taken = new Map((input.taken ?? []).map((t) => [t.startAt.getTime(), t.status]));

  const slots = drafts.map((d): ComputedSlot => {
    const price =
      d.price ??
      (input.pricing ? priceFor(input.pricing, { businessDate, weekend: input.weekend, minute: d.minute }) : null);
    const status: SlotStatus =
      taken.get(d.startAt.getTime()) ??
      (blocks.some((b) => overlaps(d, b)) ? 'blocked' : d.startAt <= input.now ? 'past' : 'available');
    return {
      startAt: d.startAt,
      endAt: d.endAt,
      localStart: localParts(d.startAt, tz).hm,
      localEnd: localParts(d.endAt, tz).hm,
      price,
      status,
      source: d.source,
    };
  });

  return { businessDate, closed: false, closedReason: null, slots };
}
