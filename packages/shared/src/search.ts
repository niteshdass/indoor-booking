import type { RatingSummary } from './reviews';
import type { Sport } from './venues';

/** Radius presets offered next to "anywhere" and a custom value. */
export const SEARCH_RADII_KM = [10, 20, 30] as const;
export const MAX_SEARCH_RADIUS_KM = 500;

/** How many free start times a search result lists. */
export const FREE_TIMES_SHOWN = 3;

/** A free slot of a search result's day. */
export type NextFreeSlot = {
  turfId: string;
  turfName: string;
  startAt: string;
  endAt: string;
  localStart: string;
  localEnd: string;
  price: number;
};

export type SearchResult = {
  slug: string;
  name: string;
  address: string;
  city: string;
  country: string;
  currency: string;
  timezone: string;
  location: { lat: number; lng: number };
  photo: { url: string; alt?: string } | null;
  /** Sports of the turfs that matched the search. */
  sports: Sport[];
  /** Rounded; null when the search had no location. */
  distanceMeters: number | null;
  /** The venue-local business date the price and slot are for. */
  date: string;
  /** Lowest matching slot price in minor units of `currency`. */
  fromPrice: number | null;
  nextFreeSlot: NextFreeSlot | null;
  /** The earliest free slots, one per start time (up to `FREE_TIMES_SHOWN`); the first is `nextFreeSlot`. */
  freeTimes: NextFreeSlot[];
  /** How many distinct start times are free that day, listed or not. */
  freeTimeCount: number;
  /** Null when the venue has no reviews. */
  rating: RatingSummary | null;
};

export type SearchResponse = { results: SearchResult[]; nextCursor: number | null };

/** Most venues one player can keep saved. */
export const MAX_SAVED_VENUES = 100;

/** A venue the signed-in player saved, newest first in `GET /me/saved-venues`. */
export type SavedVenueJson = {
  slug: string;
  name: string;
  address: string;
  city: string;
  photo: { url: string; alt?: string } | null;
  /** Sports of the venue's active turfs, in catalog order. */
  sports: Sport[];
  rating: RatingSummary | null;
  savedAt: string;
};

/** A map viewport in degrees; west > east means it crosses the antimeridian. */
export type Bbox = { west: number; south: number; east: number; north: number };

export type Criteria = {
  near: { lat: number; lng: number } | null;
  radiusKm: number | null; // null = any distance
  bbox: Bbox | null; // null = no map area
  sport: Sport | null;
  indoor: boolean | null;
  date: string | null; // null = each venue's today
  from: string | null;
  to: string | null;
  currency: string | null;
  minPrice: number | null; // minor units
  maxPrice: number | null; // minor units
  available: boolean;
  sort: 'default' | 'rating';
};

export const EMPTY_CRITERIA: Criteria = {
  near: null,
  radiusKm: null,
  bbox: null,
  sport: null,
  indoor: null,
  date: null,
  from: null,
  to: null,
  currency: null,
  minPrice: null,
  maxPrice: null,
  available: false,
  sort: 'default',
};

/** Writes criteria with the API's parameter names; nulls and false are omitted. */
export function criteriaToParams(c: Criteria): URLSearchParams {
  const p = new URLSearchParams();
  if (c.near) {
    p.set('lat', String(c.near.lat));
    p.set('lng', String(c.near.lng));
    if (c.radiusKm !== null) p.set('radiusKm', String(c.radiusKm));
  }
  if (c.bbox) p.set('bbox', [c.bbox.west, c.bbox.south, c.bbox.east, c.bbox.north].join(','));
  if (c.sport) p.set('sport', c.sport);
  if (c.indoor !== null) p.set('indoor', String(c.indoor));
  if (c.date) p.set('date', c.date);
  if (c.from && c.to) {
    p.set('from', c.from);
    p.set('to', c.to);
  }
  if (c.currency && (c.minPrice !== null || c.maxPrice !== null)) p.set('currency', c.currency);
  if (c.minPrice !== null) p.set('minPrice', String(c.minPrice));
  if (c.maxPrice !== null) p.set('maxPrice', String(c.maxPrice));
  if (c.available) p.set('available', 'true');
  if (c.sort === 'rating') p.set('sort', 'rating');
  return p;
}

/** Query string for GET /search. */
export function apiQuery(c: Criteria, cursor: number, limit = 20): string {
  const p = new URLSearchParams({ limit: String(limit), cursor: String(cursor) });
  for (const [k, v] of criteriaToParams(c)) p.set(k, v);
  return `?${p.toString()}`;
}
