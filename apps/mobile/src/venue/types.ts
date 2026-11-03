import type { Amenity, RatingSummary, Sport } from '@booking/shared';

/** `GET /venues/:slug`. Mirrors apps/web/src/lib/types.ts; the API has no per-owner brand color yet, so the screen uses the `brand` tokens. */
export type PublicTurf = { id: string; name: string; sports: Sport[]; indoor: boolean; slotLengthMin: number };
export type PublicVenue = {
  slug: string;
  name: string;
  address: string;
  city: string;
  country: string;
  currency: string;
  timezone: string;
  location: { lat: number; lng: number };
  photos: { url: string; alt?: string }[];
  amenities: Amenity[];
  turfs: PublicTurf[];
  rating: RatingSummary | null;
};
