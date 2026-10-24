import type { TurfPricing } from '@booking/shared';
import { Venue, type VenueDoc } from '../../src/venues/venue.model';
import { Turf, type TurfDoc } from '../../src/venues/turf.model';

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
    location: { type: 'Point', coordinates: [90.41, 23.81] },
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
    slotLengthMin: number;
    settings: Record<string, unknown>;
    pricing: TurfPricing | null;
  }> = {},
): Promise<TurfDoc> {
  seq += 1;
  return Turf.create({
    ownerId,
    venueId,
    name: over.name ?? `Court ${seq}`,
    sports: ['football'],
    indoor: false,
    slotLengthMin: over.slotLengthMin ?? 60,
    active: over.active ?? true,
    settings: over.settings ?? {},
    pricing: over.pricing ?? null,
  });
}
