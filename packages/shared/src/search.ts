import type { Sport } from './venues';

/** Radius presets offered next to "anywhere" and a custom value. */
export const SEARCH_RADII_KM = [10, 20, 30] as const;
export const MAX_SEARCH_RADIUS_KM = 500;

/** The earliest free slot of a search result's day. */
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
};

export type SearchResponse = { results: SearchResult[]; nextCursor: number | null };
