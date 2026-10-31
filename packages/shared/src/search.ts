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
