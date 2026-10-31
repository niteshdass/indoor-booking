import { addDays, FEE_OWING_STATUSES, localParts, rangeMinutes, weekdayOf, WEEKDAYS, type BookingStatus, type WeeklyHours } from '@booking/shared';

/** Statuses whose court time was (or will be) played and whose total counts as earned. */
export const PLAYED_STATUSES: readonly BookingStatus[] = ['confirmed', 'completed', 'no_show'];
/** Statuses that never became a real booking; left out of rates. */
const NEVER_BOOKED: readonly BookingStatus[] = ['awaiting_payment', 'expired'];

export const OVERVIEW_DAYS = [7, 30, 90] as const;

/** The booking fields the overview reads. */
export type OverviewBooking = {
  turfId: string;
  businessDate: string;
  status: BookingStatus;
  source: 'online' | 'walkin';
  slots: { startAt: Date; endAt: Date }[];
  subtotal: number;
  addonsTotal: number;
  total: number;
  amountPaid: number;
  amountRefunded: number;
  platformFee: { amount: number; payer: 'owner' | 'player' } | null;
};

export type OverviewTurf = { id: string; name: string; hours: WeeklyHours };

export type Range = { from: string; to: string };

/** `days` days ending today (venue time), and the same number of days before them. */
export function overviewRanges(days: number, now: Date, tz: string): { current: Range; previous: Range } {
  const to = localParts(now, tz).date;
  const from = addDays(to, -(days - 1));
  return { current: { from, to }, previous: { from: addDays(from, -days), to: addDays(from, -1) } };
}

export function datesOf({ from, to }: Range): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const minutesOf = (b: OverviewBooking) => b.slots.reduce((sum, s) => sum + (s.endAt.getTime() - s.startAt.getTime()) / 60_000, 0);
const played = (b: OverviewBooking) => PLAYED_STATUSES.includes(b.status);
const kept = (b: OverviewBooking) => Math.max(0, b.amountPaid - b.amountRefunded);
/** The platform fee a booking owes; nothing once it is cancelled, rejected or unpaid. */
export const feeOf = (b: OverviewBooking) => (FEE_OWING_STATUSES.includes(b.status) && b.platformFee ? b.platformFee.amount : 0);
/** What a booking earned: the total once played (less its platform fee), or what was kept after a cancellation. */
export const earned = (b: OverviewBooking) => Math.max(0, (played(b) ? b.total : b.status === 'cancelled' ? kept(b) : 0) - feeOf(b));

/**
 * A played booking's court and add-on earnings, net of its platform fee. A player-paid fee sits on
 * top of both, so nothing comes off; an owner-paid fee comes off the court price first, then add-ons.
 */
function netParts(b: OverviewBooking): { courts: number; addons: number } {
  const ownerFee = b.platformFee?.payer === 'owner' ? feeOf(b) : 0;
  const courts = Math.max(0, b.subtotal - ownerFee);
  const addons = Math.max(0, b.addonsTotal - Math.max(0, ownerFee - b.subtotal));
  return { courts, addons };
}

/** Minutes a turf is open on `date` by its weekly hours (closures and one-off changes are not counted). */
export function openMinutes(hours: WeeklyHours, date: string): number {
  const day = hours[weekdayOf(date)];
  if (day === 'closed') return 0;
  const [s, e] = rangeMinutes({ start: day.open, end: day.close });
  return e - s;
}

type Totals = { revenue: number; platformFees: number; playedNet: number; bookings: number; minutes: number; openMinutes: number; cancelled: number; decided: number };

function totals(bookings: OverviewBooking[], turfs: OverviewTurf[], range: Range): Totals {
  const days = datesOf(range);
  let revenue = 0;
  let platformFees = 0;
  let playedNet = 0;
  let count = 0;
  let minutes = 0;
  let cancelled = 0;
  let decided = 0;
  for (const b of bookings) {
    revenue += earned(b);
    if (played(b)) {
      platformFees += feeOf(b);
      playedNet += Math.max(0, b.total - feeOf(b));
      count += 1;
            minutes += minutesOf(b);
    }
    if (!NEVER_BOOKED.includes(b.status)) decided += 1;
    if (b.status === 'cancelled') cancelled += 1;
  }
  const open = turfs.reduce((sum, t) => sum + days.reduce((s, d) => s + openMinutes(t.hours, d), 0), 0);
  return { revenue, platformFees, playedNet, bookings: count, minutes, openMinutes: open, cancelled, decided };
}

/** Everything the owner Overview page shows, from the bookings of both periods. */
export function buildOverview(input: {
  current: OverviewBooking[];
  previous: OverviewBooking[];
  turfs: OverviewTurf[];
  ranges: { current: Range; previous: Range };
  timezone: string;
}) {
  const { current, previous, turfs, ranges, timezone } = input;
  const now = totals(current, turfs, ranges.current);
  const before = totals(previous, turfs, ranges.previous);

  const prevDates = datesOf(ranges.previous);
  const daily = datesOf(ranges.current).map((date, i) => {
    const day = current.filter((b) => b.businessDate === date);
    const prev = previous.filter((b) => b.businessDate === prevDates[i]);
    const sum = (list: OverviewBooking[], f: (b: OverviewBooking) => number) => list.reduce((s, b) => s + f(b), 0);
    return {
      date,
      online: sum(day.filter((b) => b.source === 'online'), earned),
      walkin: sum(day.filter((b) => b.source === 'walkin'), earned),
      bookings: day.filter(played).length,
      minutes: sum(day.filter(played), minutesOf),
      previous: {
        revenue: sum(prev, earned),
        bookings: prev.filter(played).length,
        minutes: sum(prev.filter(played), minutesOf),
      },
    };
  });

  const playedNow = current.filter(played);
  const mix = {
    courts: playedNow.reduce((s, b) => s + netParts(b).courts, 0),
    addons: playedNow.reduce((s, b) => s + netParts(b).addons, 0),
    cancellationFees: current.filter((b) => b.status === 'cancelled').reduce((s, b) => s + kept(b), 0),
    collected: current.reduce((s, b) => s + kept(b), 0),
    outstanding: playedNow.reduce((s, b) => s + Math.max(0, b.total - kept(b)), 0),
  };

  // Booked hours by weekday (Monday first) and local start hour.
  const heatmap = WEEKDAYS.map(() => Array.from({ length: 24 }, () => 0));
  for (const b of playedNow) {
    for (const s of b.slots) {
      const { date, hm } = localParts(s.startAt, timezone);
      const row = WEEKDAYS.indexOf(weekdayOf(date));
      heatmap[row]![Number(hm.slice(0, 2))]! += (s.endAt.getTime() - s.startAt.getTime()) / 3_600_000;
    }
  }

  const days = datesOf(ranges.current);
  const courts = turfs
    .map((t) => {
      const mine = current.filter((b) => b.turfId === t.id);
      return {
        id: t.id,
        name: t.name,
        revenue: mine.reduce((s, b) => s + earned(b), 0),
        bookings: mine.filter(played).length,
        minutes: mine.filter(played).reduce((s, b) => s + minutesOf(b), 0),
        openMinutes: days.reduce((s, d) => s + openMinutes(t.hours, d), 0),
        previousRevenue: previous.filter((b) => b.turfId === t.id).reduce((s, b) => s + earned(b), 0),
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.minutes - a.minutes);

  const statuses: Partial<Record<BookingStatus, number>> = {};
  for (const b of current) statuses[b.status] = (statuses[b.status] ?? 0) + 1;

  const kpi = (pick: (t: Totals) => number) => ({ value: pick(now), previous: pick(before) });
  return {
    platformFees: now.platformFees,
    kpis: {
      revenue: kpi((t) => t.revenue),
      bookings: kpi((t) => t.bookings),
      minutes: kpi((t) => t.minutes),
      utilization: kpi((t) => (t.openMinutes > 0 ? t.minutes / t.openMinutes : 0)),
      averageBooking: kpi((t) => (t.bookings > 0 ? Math.round(t.playedNet / t.bookings) : 0)),
      cancellationRate: kpi((t) => (t.decided > 0 ? t.cancelled / t.decided : 0)),
    },
    daily,
    mix,
    heatmap,
    courts,
    statuses,
  };
}
