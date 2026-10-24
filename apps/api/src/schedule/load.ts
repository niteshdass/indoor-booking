import { addDays, computeSlots, localParts, weekdayOf, type DaySlots, type EffectiveSettings, type TurfPricing } from '@booking/shared';
import type { TurfDoc } from '../venues/turf.model';
import type { VenueDoc } from '../venues/venue.model';
import { effectiveForTurf } from '../venues/effective';
import { closureFor } from './closure.model';
import { overridesFor } from './slotOverride.model';

/**
 * One business day of a turf: effective settings, closure, overrides, then computeSlots. The day
 * before is computed too, and its slots win: a slot of this day overlapping one of the day before
 * (a night session or extra running past midnight) is dropped, so no instant is offered twice.
 * Plan 07 adds `taken`.
 */
export async function loadDay(
  ownerId: string,
  venue: VenueDoc,
  turf: TurfDoc,
  businessDate: string,
  now: Date,
): Promise<{ day: DaySlots; settings: EffectiveSettings }> {
  const settings = await effectiveForTurf(ownerId, venue, turf);
  const [day, before] = await Promise.all([
    computeDay(ownerId, venue, turf, settings, businessDate, now),
    computeDay(ownerId, venue, turf, settings, addDays(businessDate, -1), now),
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
    now,
  });
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
