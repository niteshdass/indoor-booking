import type { Sport, TurfPricing } from '@booking/shared';
import { Venue, type VenueDoc } from '../../src/venues/venue.model';
import { Turf, type TurfDoc } from '../../src/venues/turf.model';
import { Booking } from '../../src/bookings/booking.model';

let seq = 0;

/** A venue of `ownerId` inserted directly (no API, no activity log). */
export async function seedVenue(
  ownerId: string,
  over: Partial<{
    name: string;
    slug: string;
    published: boolean;
    timezone: string;
    currency: string;
    settings: Record<string, unknown>;
    location: [number, number];
  }> = {},
): Promise<VenueDoc> {
  seq += 1;
  return Venue.create({
    ownerId,
    name: over.name ?? `Venue ${seq}`,
    slug: over.slug ?? `venue-seed-${seq}`,
    address: 'Road 1',
    city: 'Dhaka',
    country: 'BD',
    currency: over.currency ?? 'BDT',
    timezone: over.timezone ?? 'Asia/Dhaka',
    location: { type: 'Point', coordinates: over.location ?? [90.41, 23.81] },
    published: over.published ?? false,
    settings: over.settings ?? {},
  });
}

/** A turf of `venueId` inserted directly. */
export async function seedTurf(
  ownerId: string,
  venueId: string,
  over: Partial<{
    name: string;
    active: boolean;
    indoor: boolean;
    slotLengthMin: number;
    settings: Record<string, unknown>;
    pricing: TurfPricing | null;
    sports: Sport[];
  }> = {},
): Promise<TurfDoc> {
  seq += 1;
  return Turf.create({
    ownerId,
    venueId,
    name: over.name ?? `Court ${seq}`,
    sports: over.sports ?? ['football'],
    indoor: over.indoor ?? false,
    slotLengthMin: over.slotLengthMin ?? 60,
    active: over.active ?? true,
    settings: over.settings ?? {},
    pricing: over.pricing ?? null,
  });
}

/**
 * A long-past cancelled booking of `playerId` at the turf, inserted directly: makes the player one of
 * the venue's customers, whom staff may then name on a walk-in or series.
 */
export async function seedCustomer(ownerId: string, venueId: string, turfId: string, playerId: string): Promise<void> {
  seq += 1;
  const startAt = new Date('2020-01-01T10:00:00Z');
  const endAt = new Date('2020-01-01T11:00:00Z');
  await Booking.create({
    ownerId,
    venueId,
    turfId,
    reference: `PAST${seq}`,
    businessDate: '2020-01-01',
    startAt,
    endAt,
    slots: [{ startAt, endAt, price: 1000 }],
    currency: 'BDT',
    subtotal: 1000,
    addonsTotal: 0,
    total: 1000,
    advanceRequired: 0,
    status: 'cancelled',
    paymentStatus: 'unpaid',
    source: 'online',
    playerId,
    guest: null,
    policySnapshot: { paymentPolicy: { type: 'none' }, refundRules: [] },
  });
}
