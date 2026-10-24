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
} from '@booking/shared';
import { Booking, holdingFilter } from '../bookings/booking.model';
import type { TurfDoc } from '../venues/turf.model';
import type { VenueDoc } from '../venues/venue.model';
import { effectiveForTurf } from '../venues/effective';
import { closureFor } from './closure.model';
import { overridesFor } from './slotOverride.model';

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
): Promise<{ day: DaySlots; settings: EffectiveSettings }> {
  const [settings, taken] = await Promise.all([
    effectiveForTurf(ownerId, venue, turf),
    takenSlots(ownerId, venue, turf, businessDate, now),
  ]);
  const [day, before] = await Promise.all([
    computeDay(ownerId, venue, turf, settings, businessDate, now, taken),
    computeDay(ownerId, venue, turf, settings, addDays(businessDate, -1), now, taken),
  ]);
  const slots = day.slots.filter((s) => !before.slots.some((b) => s.startAt < b.endAt && b.startAt < s.endAt));
  return { day: { ...day, slots }, settings };
}

async function computeDay(
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
    closureFor(ownerId, venueId, turfId, businessDate),
    overridesFor(ownerId, turfId, businessDate),
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
async function takenSlots(ownerId: string, venue: VenueDoc, turf: TurfDoc, businessDate: string, now: Date): Promise<Taken> {
  const from = localToUtc(addDays(businessDate, -1), 0, venue.timezone);
  const to = localToUtc(addDays(businessDate, 2), 0, venue.timezone);
  const bookings = await Booking.find(
    { ownerId, turfId: turf._id, startAt: { $lt: to }, endAt: { $gt: from }, ...holdingFilter(now) },
    { status: 1, slots: 1 },
  ).lean();
  return bookings.flatMap((b) =>
    b.slots.map((s) => ({ startAt: s.startAt, endAt: s.endAt, status: PENDING.includes(b.status) ? ('pending' as const) : ('booked' as const) })),
  );
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
