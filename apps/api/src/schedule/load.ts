import { addDays, computeSlots, localParts, weekdayOf, type DaySlots, type EffectiveSettings, type TurfPricing } from '@booking/shared';
import type { TurfDoc } from '../venues/turf.model';
import type { VenueDoc } from '../venues/venue.model';
import { effectiveForTurf } from '../venues/effective';
import { closureFor } from './closure.model';
import { overridesFor } from './slotOverride.model';

/** One business day of a turf: effective settings, closure, overrides, then computeSlots. Plan 07 adds `taken`. */
export async function loadDay(
  ownerId: string,
  venue: VenueDoc,
  turf: TurfDoc,
  businessDate: string,
  now: Date,
): Promise<{ day: DaySlots; settings: EffectiveSettings }> {
  const venueId = venue.id as string;
  const turfId = turf.id as string;
  const settings = await effectiveForTurf(ownerId, venue, turf);
  const weekday = weekdayOf(businessDate);
  const [closure, overrides] = await Promise.all([
    closureFor(ownerId, venueId, turfId, businessDate),
    overridesFor(ownerId, turfId, businessDate),
  ]);
  const day = computeSlots({
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
  return { day, settings };
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
