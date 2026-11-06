import { amountDue, localParts } from '@booking/shared';
import { awaitsVerification, endOf, startOf } from '../booking/model';
import type { OwnerBooking, OwnerSlotDay, OwnerTurf } from '../types';

/** Ports of apps/web/src/owner/today/summarize.ts and the pure parts of CourtTimeline.tsx. */

const DEAD = new Set(['cancelled', 'rejected', 'expired']);
const OPEN = new Set(['pending', 'awaiting_payment', 'confirmed']);

export type TodaySummary = {
  count: number;
  collected: number;
  due: { amount: number; owing: number; overdue: number };
  pending: number;
  upcoming: OwnerBooking[];
};

/** Day totals for the stat tiles plus the still-to-come queue. Collected nets refunds and includes cancelled bookings. */
export function summarize(bookings: OwnerBooking[], nowMs: number = Date.now()): TodaySummary {
  const owing = bookings.filter((b) => amountDue(b) > 0);
  return {
    count: bookings.filter((b) => !DEAD.has(b.status)).length,
    collected: bookings.reduce((sum, b) => sum + b.amountPaid - b.amountRefunded, 0),
    due: {
      amount: owing.reduce((sum, b) => sum + amountDue(b), 0),
      owing: owing.length,
      overdue: owing.filter((b) => endOf(b) <= nowMs).length,
    },
    pending: bookings.filter((b) => b.status === 'pending' && !awaitsVerification(b)).length,
    upcoming: bookings.filter((b) => OPEN.has(b.status) && endOf(b) > nowMs).sort((a, b) => startOf(a) - startOf(b)),
  };
}

export type Courts = { turfs: OwnerTurf[]; days: Record<string, OwnerSlotDay> };

/** Statuses drawn on the schedule. */
export const SHOWN = new Set<OwnerBooking['status']>(['pending', 'awaiting_payment', 'confirmed', 'completed']);
/** Statuses where unpaid money is still to collect. */
const OWES = new Set<OwnerBooking['status']>(['pending', 'confirmed', 'completed']);
export const dueOf = (b: OwnerBooking) => (OWES.has(b.status) ? Math.max(0, b.total - b.amountPaid) : 0);

/** "18:30" → minutes since midnight; an end at or before its start (00:00) reads as midnight. */
function hmMin(hm: string, after?: number): number {
  const [h, m] = hm.split(':').map(Number);
  const v = h! * 60 + m!;
  return after !== undefined && v <= after ? 24 * 60 : v;
}
const slotSpan = (s: { localStart: string; localEnd: string }): [number, number] => {
  const a = hmMin(s.localStart);
  return [a, hmMin(s.localEnd, a)];
};

/** Booked and bookable hours across the courts; null without court data or when nothing is open. */
export function courtUsage(bookings: OwnerBooking[], courts: Courts | null, tz: string): { booked: number; open: number } | null {
  if (!courts) return null;
  let open = 0;
  for (const turf of courts.turfs) {
    const day = courts.days[turf.id];
    if (!day || day.closed) continue;
    for (const s of day.slots) {
      if (s.status === 'blocked') continue;
      const [a, b] = slotSpan(s);
      open += b - a;
    }
  }
  if (open === 0) return null;
  const ids = new Set(courts.turfs.map((x) => x.id));
  let booked = 0;
  for (const b of bookings) {
    if (!SHOWN.has(b.status) || !ids.has(b.turfId)) continue;
    for (const s of b.slots) {
      const start = hmMin(localParts(new Date(s.startAt), tz).hm);
      booked += hmMin(localParts(new Date(s.endAt), tz).hm, start) - start;
    }
  }
  return { booked: Math.min(booked, open) / 60, open: open / 60 };
}

/** One row of a court's day, top to bottom. Times are venue-clock "HH:MM". */
export type ScheduleRow =
  | { kind: 'booking'; key: string; from: string; to: string; startMs: number; endMs: number; booking: OwnerBooking }
  | { kind: 'free'; key: string; from: string; to: string; startMs: number; endMs: number; startAt: string; price: number }
  | { kind: 'closed'; key: string; from: string; to: string; startMs: number; endMs: number };

/**
 * A court's day as a list: live bookings, runs of free slots (past and held slots dropped) and closed runs
 * (blocked slots, or the whole day). `nowMs` drops free slots that have started.
 */
export function scheduleRows(day: OwnerSlotDay | undefined, bookings: OwnerBooking[], tz: string, nowMs: number): ScheduleRow[] {
  const live = bookings.filter((b) => SHOWN.has(b.status) && b.slots.length > 0);
  const rows: ScheduleRow[] = live.map((b) => ({
    kind: 'booking',
    key: `b${b.id}`,
    from: localParts(new Date(startOf(b)), tz).hm,
    to: localParts(new Date(endOf(b)), tz).hm,
    startMs: startOf(b),
    endMs: endOf(b),
    booking: b,
  }));
  if (day && day.closed) {
    const first = day.slots[0];
    const last = day.slots.at(-1);
    rows.push({
      kind: 'closed',
      key: 'closed',
      from: first?.localStart ?? '',
      to: last?.localEnd ?? '',
      startMs: first ? Date.parse(first.startAt) : 0,
      endMs: last ? Date.parse(last.endAt) : 0,
    });
  } else {
    const held = live.flatMap((b) => b.slots.map((x): [number, number] => [Date.parse(x.startAt), Date.parse(x.endAt)]));
    let run: Extract<ScheduleRow, { kind: 'free' | 'closed' }> | null = null;
    for (const s of day?.slots ?? []) {
      const at = Date.parse(s.startAt);
      const until = Date.parse(s.endAt);
      const kind: 'free' | 'closed' | null =
        s.status === 'blocked' ? 'closed' : s.status === 'available' && at >= nowMs && !held.some(([a, b]) => a < until && b > at) ? 'free' : null;
      if (kind && run && run.kind === kind && run.endMs === at) {
        run.to = s.localEnd;
        run.endMs = until;
        continue;
      }
      if (!kind) {
        run = null;
        continue;
      }
      run =
        kind === 'free'
          ? { kind, key: `f${s.startAt}`, from: s.localStart, to: s.localEnd, startMs: at, endMs: until, startAt: s.startAt, price: s.price ?? 0 }
          : { kind, key: `c${s.startAt}`, from: s.localStart, to: s.localEnd, startMs: at, endMs: until };
      rows.push(run);
    }
  }
  return rows.sort((a, b) => a.startMs - b.startMs);
}
