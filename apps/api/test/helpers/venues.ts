import { Venue, type VenueDoc } from '../../src/venues/venue.model';

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
