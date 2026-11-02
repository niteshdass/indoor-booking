export type LatLng = { lat: number; lng: number };

/** A place the geocoder found: its point, the area to show and the town it is in. */
export type Place = {
  label: string;
  lat: number;
  lng: number;
  /** [south, west, north, east] */
  bounds: [number, number, number, number] | null;
  city: string | null;
};

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
// Most precise first: a Google place's own pin (!3d…!4d…), then a query point, then the map centre (@lat,lng).
const LINK_PATTERNS = [
  new RegExp(String.raw`!3d${NUM}!4d${NUM}`),
  new RegExp(String.raw`[?&](?:q|query|ll|center|destination|daddr)=(?:loc:)?${NUM},\s*${NUM}`),
  new RegExp(String.raw`@${NUM},${NUM}`),
  new RegExp(String.raw`^\s*${NUM}°?\s*[,;\s]\s*${NUM}°?\s*$`),
];

const valid = (lat: number, lng: number) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Coordinates from "23.79, 90.41" or a Google, Apple or OpenStreetMap link that carries them; else null. */
export function coordsFromText(text: string): LatLng | null {
  let s = text.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    // Keep the raw text: a stray % is not worth refusing the paste over.
  }
  for (const re of LINK_PATTERNS) {
    const m = re.exec(s);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (valid(lat, lng)) return { lat, lng };
  }
  return null;
}

const SHORT_LINK_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co']);

/** A Google Maps share link (maps.app.goo.gl/…) that only the server can follow to its coordinates. */
export function isShortMapLink(text: string): boolean {
  try {
    const u = new URL(text.trim());
    return u.protocol === 'https:' && SHORT_LINK_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

type GeoEnv = { VITE_GEOCODER_URL?: string };

/**
 * Nominatim-compatible search endpoint. The public OpenStreetMap one allows light use with no key as long as
 * nobody searches on every keystroke, which is why the form searches on Enter or the button only.
 */
export const geocoderUrl = (env: GeoEnv) => env.VITE_GEOCODER_URL?.trim() || 'https://nominatim.openstreetmap.org/search';

type NominatimHit = {
  display_name: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
  address?: Record<string, string | undefined>;
};

export function toPlace(hit: NominatimHit): Place {
  const b = hit.boundingbox?.map(Number);
  const a = hit.address ?? {};
  return {
    label: hit.display_name,
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    bounds: b && b.every(Number.isFinite) ? [b[0]!, b[2]!, b[1]!, b[3]!] : null,
    city: a.city ?? a.town ?? a.municipality ?? a.city_district ?? a.county ?? a.state_district ?? null,
  };
}

/** Up to five places matching `query`, in `country` (ISO alpha-2) when given, named in `lang`. */
export async function searchPlaces(
  query: string,
  { country, lang, signal }: { country?: string; lang: string; signal?: AbortSignal },
  base = geocoderUrl({ VITE_GEOCODER_URL: import.meta.env.VITE_GEOCODER_URL }),
): Promise<Place[]> {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', limit: '5', 'accept-language': lang });
  if (country) params.set('countrycodes', country.toLowerCase());
  const res = await fetch(`${base}?${params}`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geocoder answered ${res.status}`);
  return ((await res.json()) as NominatimHit[]).map(toPlace).filter((p) => valid(p.lat, p.lng));
}
