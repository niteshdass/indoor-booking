import {
  addDays,
  computeSlots,
  localParts,
  localToUtc,
  weekdayOf,
  type BookingStatus,
  type DaySlots,
  type EffectiveSettings,
  type TurfPricing,
  overrideAppliesOn,
  resolveSettings,
  withOwnerDefaults,
  type OverrideRule,
  type OwnerSettings,
  type TurfSettingsOverride,
  type VenueSettingsOverride,
} from '@booking/shared';
import { Booking, holdingFilter } from '../bookings/booking.model';
import type { TurfDoc } from '../venues/turf.model';
import type { VenueDoc } from '../venues/venue.model';
import { effectiveForTurf } from '../venues/effective';
import { Owner } from '../tenancy/owner.model';
import { Closure, closureFor } from './closure.model';
import { SlotOverride, overlapsDatesFilter, overrideRule, overrideWhen, overridesFor } from './slotOverride.model';

type Closed = { reason: string | null } | null;
type Overrides = (OverrideRule & { reason: string | null })[];

/** Where loadDay reads its inputs: the database one turf at a time, or a batch read up front (dayBatch). */
export type DaySources = {
  settings(ownerId: string, venue: VenueDoc, turf: TurfDoc): Promise<EffectiveSettings>;
  bookings(ownerId: string, turf: TurfDoc, from: Date, to: Date, now: Date): Promise<HeldBooking[]>;
  closure(ownerId: string, venueId: string, turfId: string, date: string): Promise<Closed>;
  overrides(ownerId: string, turfId: string, date: string): Promise<Overrides>;
};

type HeldBooking = { status: BookingStatus; slots: { startAt: Date; endAt: Date }[] };

const dbSources: DaySources = {
  settings: effectiveForTurf,
  bookings: (ownerId, turf, from, to, now) =>
    Booking.find(
      { ownerId, turfId: turf._id, startAt: { $lt: to }, endAt: { $gt: from }, ...holdingFilter(now) },
      { status: 1, slots: 1 },
    ).lean(),
  closure: closureFor,
  overrides: overridesFor,
};

/**
 * One business day of a turf: effective settings, closure, overrides, then computeSlots. The day
 * before is computed too, and its slots win: a slot of this day overlapping one of the day before
 * (a night session or extra running past midnight) is dropped, so no instant is offered twice.
 * Slots of bookings that hold them show as booked or pending.
 */
export async function loadDay(
  ownerId: string,
  venue: VenueDoc,
  turf: TurfDoc,
  businessDate: string,
  now: Date,
  sources: DaySources = dbSources,
): Promise<{ day: DaySlots; settings: EffectiveSettings }> {
  const [settings, taken] = await Promise.all([
    sources.settings(ownerId, venue, turf),
    takenSlots(sources, ownerId, venue, turf, businessDate, now),
  ]);
  const [day, before] = await Promise.all([
    computeDay(sources, ownerId, venue, turf, settings, businessDate, now, taken),
    computeDay(sources, ownerId, venue, turf, settings, addDays(businessDate, -1), now, taken),
  ]);
  const slots = day.slots.filter((s) => !before.slots.some((b) => s.startAt < b.endAt && b.startAt < s.endAt));
  return { day: { ...day, slots }, settings };
}

async function computeDay(
  sources: DaySources,
  ownerId: string,
  venue: VenueDoc,
  turf: TurfDoc,
  settings: EffectiveSettings,
  businessDate: string,
  now: Date,
  taken: Taken,
): Promise<DaySlots> {
  const venueId = venue.id as string;
  const turfId = turf.id as string;
  const weekday = weekdayOf(businessDate);
  const [closure, overrides] = await Promise.all([
    sources.closure(ownerId, venueId, turfId, businessDate),
    sources.overrides(ownerId, turfId, businessDate),
  ]);
  return computeSlots({
    businessDate,
    timezone: venue.timezone,
    hours: settings.hours[weekday],
    weekend: settings.weekendDays.includes(weekday),
    slotLengthMin: turf.slotLengthMin,
    pricing: (turf.pricing ?? null) as TurfPricing | null,
    overrides,
    closure,
    taken,
    now,
  });
}

type Taken = { startAt: Date; endAt: Date; status: 'pending' | 'booked' }[];

const PENDING: readonly BookingStatus[] = ['pending', 'awaiting_payment'];

/**
 * Slots held by the turf's bookings from the start of the day before to the end of the day after:
 * wide enough for both computed days, night sessions included. Matched to the grid by overlap, so a moved grid still sees them.
 */
const bookingWindow = (venue: VenueDoc, businessDate: string) => ({
  from: localToUtc(addDays(businessDate, -1), 0, venue.timezone),
  to: localToUtc(addDays(businessDate, 2), 0, venue.timezone),
});

async function takenSlots(
  sources: DaySources,
  ownerId: string,
  venue: VenueDoc,
  turf: TurfDoc,
  businessDate: string,
  now: Date,
): Promise<Taken> {
  const { from, to } = bookingWindow(venue, businessDate);
  const bookings = await sources.bookings(ownerId, turf, from, to, now);
  return bookings.flatMap((b) =>
    b.slots.map((s) => ({ startAt: s.startAt, endAt: s.endAt, status: PENDING.includes(b.status) ? ('pending' as const) : ('booked' as const) })),
  );
}

export type DayRequest = { ownerId: string; venue: VenueDoc; turfs: TurfDoc[]; date: string };

/**
 * DaySources for loading many turfs' days at once (search): four queries for the whole batch
 * instead of six per turf. Each lookup then applies the same match as its database version.
 */
export async function dayBatch(requests: DayRequest[], now: Date): Promise<DaySources> {
  if (requests.length === 0) return dbSources;
  const ownerIds = [...new Set(requests.map((r) => r.ownerId))];
  const turfIds = requests.flatMap((r) => r.turfs.map((t) => t._id));
  const dates = requests.flatMap((r) => [addDays(r.date, -1), r.date]).sort();
  const firstDate = dates[0]!;
  const lastDate = dates[dates.length - 1]!;
  const windows = requests.map((r) => bookingWindow(r.venue, r.date));
  const from = new Date(Math.min(...windows.map((w) => w.from.getTime())));
  const to = new Date(Math.max(...windows.map((w) => w.to.getTime())));

  const [owners, bookings, closures, overrides] = await Promise.all([
    Owner.find({ _id: { $in: ownerIds } }, { settings: 1 }).lean(),
    Booking.find(
      { ownerId: { $in: ownerIds }, turfId: { $in: turfIds }, startAt: { $lt: to }, endAt: { $gt: from }, ...holdingFilter(now) },
      { ownerId: 1, turfId: 1, status: 1, slots: 1, startAt: 1, endAt: 1 },
    ).lean(),
    Closure.find({ ownerId: { $in: ownerIds }, from: { $lte: lastDate }, to: { $gte: firstDate } })
      .sort({ _id: 1 })
      .lean(),
    SlotOverride.find({ ownerId: { $in: ownerIds }, turfId: { $in: turfIds }, ...overlapsDatesFilter(firstDate, lastDate) })
      .sort({ _id: 1 })
      .lean(),
  ]);

  const settingsOf = new Map(
    owners.map((o) => [String(o._id), withOwnerDefaults((o.settings ?? {}) as Partial<OwnerSettings>)]),
  );
  const same = (a: unknown, b: string) => a !== null && a !== undefined && String(a) === b;

  return {
    settings: async (ownerId, venue, turf) =>
      resolveSettings(
        settingsOf.get(ownerId) ?? withOwnerDefaults({}),
        (venue.settings ?? {}) as VenueSettingsOverride,
        (turf.settings ?? {}) as TurfSettingsOverride,
      ),
    bookings: async (ownerId, turf, f, t) =>
      bookings.filter(
        (b) => same(b.ownerId, ownerId) && same(b.turfId, String(turf._id)) && b.startAt < t && b.endAt > f,
      ),
    closure: async (ownerId, venueId, turfId, date) => {
      const hit = closures.find(
        (c) =>
          same(c.ownerId, ownerId) &&
          c.from <= date &&
          c.to >= date &&
          (c.venueId == null || (same(c.venueId, venueId) && (c.turfId == null || same(c.turfId, turfId)))),
      );
      return hit ? { reason: hit.reason ?? null } : null;
    },
    overrides: async (ownerId, turfId, date) =>
      overrides
        .filter((o) => same(o.ownerId, ownerId) && same(o.turfId, turfId) && overrideAppliesOn(overrideWhen(o), date))
        .map((o) => ({ ...overrideRule(o), reason: o.reason ?? null })),
  };
}

/** localToday - 1 <= d <= localToday + bookingWindowDays; the -1 keeps last night's past-midnight session bookable. */
export function inWindow(businessDate: string, now: Date, tz: string, bookingWindowDays: number): boolean {
  const today = localParts(now, tz).date;
  return businessDate >= addDays(today, -1) && businessDate <= addDays(today, bookingWindowDays);
}

export const slotJson = (s: DaySlots['slots'][number]) => ({
  startAt: s.startAt.toISOString(),
  endAt: s.endAt.toISOString(),
  localStart: s.localStart,
  localEnd: s.localEnd,
  price: s.price,
  status: s.status,
  source: s.source,
});

/** Public shape: no `source`. */
export const publicSlotJson = ({ source: _source, ...rest }: ReturnType<typeof slotJson>) => rest;
