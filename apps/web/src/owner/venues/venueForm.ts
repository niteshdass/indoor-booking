import { SLUG_RE, isTimeZone, type Amenity } from '@booking/shared';
import type { OwnerVenue } from '../types';

export type VenueDraft = {
  name: string;
  slug: string;
  address: string;
  city: string;
  country: string;
  timezone: string;
  currency: string;
  lat: string;
  lng: string;
  amenities: Amenity[];
  photos: { url: string; alt: string }[];
};

export const MAX_PHOTOS = 20;
const SLUG_MIN = 3;
const SLUG_MAX = 60;

export function draftFromVenue(v: OwnerVenue): VenueDraft {
  return {
    name: v.name,
    slug: v.slug,
    address: v.address,
    city: v.city,
    country: v.country,
    timezone: v.timezone,
    currency: v.currency,
    lat: String(v.location.lat),
    lng: String(v.location.lng),
    amenities: [...v.amenities],
    photos: v.photos.map((p) => ({ url: p.url, alt: p.alt ?? '' })),
  };
}

/** A decimal in [-max, max], or null for empty, non-numeric or out-of-range text. */
export function parseCoord(text: string, max: number): number | null {
  const s = text.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

const within = (s: string, max: number) => s.trim().length >= 1 && s.trim().length <= max;

/** Field to i18n key of its error; an empty object means the draft can be sent. Mirrors the API's schema. */
export function validateVenue(d: VenueDraft, isNew: boolean): Partial<Record<keyof VenueDraft, string>> {
  const e: Partial<Record<keyof VenueDraft, string>> = {};
  if (!within(d.name, 100)) e.name = 'owner.venues.err.name';
  if (!within(d.address, 300)) e.address = 'owner.venues.err.address';
  if (!within(d.city, 100)) e.city = 'owner.venues.err.city';
  if (!/^[A-Z]{2}$/.test(d.country.trim())) e.country = 'owner.venues.err.country';
  if (!isTimeZone(d.timezone.trim())) e.timezone = 'owner.venues.err.timezone';
  if (parseCoord(d.lat, 90) === null) e.lat = 'owner.venues.err.lat';
  if (parseCoord(d.lng, 180) === null) e.lng = 'owner.venues.err.lng';
  const slug = d.slug.trim();
  if (slug !== '' && (!SLUG_RE.test(slug) || slug.length < SLUG_MIN || slug.length > SLUG_MAX)) e.slug = 'owner.venues.err.slug';
  if (isNew && d.currency.trim() !== '' && !/^[A-Za-z]{3}$/.test(d.currency.trim())) e.currency = 'owner.venues.err.currency';
  if (d.photos.length > MAX_PHOTOS) e.photos = 'owner.venues.err.photoCount';
  else if (d.photos.some((p) => !p.url.trim().startsWith('https://') || p.url.trim().length > 2000)) e.photos = 'owner.venues.err.photoUrl';
  return e;
}

const photoBody = (photos: VenueDraft['photos']) =>
  photos.map((p) => {
    const alt = p.alt.trim();
    return alt === '' ? { url: p.url.trim() } : { url: p.url.trim(), alt };
  });

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * The request body. Create sends every field (`slug`, `currency` only when set); edit sends only what changed from
 * `original`, never `currency` (the API's PATCH rejects it), and never clears the slug.
 */
export function venueBody(d: VenueDraft, original: OwnerVenue | null): Record<string, unknown> {
  const fields = {
    name: d.name.trim(),
    address: d.address.trim(),
    city: d.city.trim(),
    country: d.country.trim(),
    timezone: d.timezone.trim(),
    location: { lat: Number(d.lat), lng: Number(d.lng) },
    photos: photoBody(d.photos),
    amenities: [...new Set(d.amenities)],
  };
  const slug = d.slug.trim();
  const currency = d.currency.trim().toUpperCase();
  if (!original) {
    return { ...fields, ...(slug ? { slug } : {}), ...(currency ? { currency } : {}) };
  }
  const body: Record<string, unknown> = {};
  for (const k of ['name', 'address', 'city', 'country', 'timezone'] as const) {
    if (fields[k] !== original[k]) body[k] = fields[k];
  }
  if (slug && slug !== original.slug) body.slug = slug;
  if (fields.location.lat !== original.location.lat || fields.location.lng !== original.location.lng) body.location = fields.location;
  if (JSON.stringify(fields.photos) !== JSON.stringify(photoBody(draftFromVenue(original).photos))) body.photos = fields.photos;
  if (!sameSet(fields.amenities, original.amenities)) body.amenities = fields.amenities;
  return body;
}
