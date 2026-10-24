import { MAX_SEARCH_RADIUS_KM, SPORTS, currencyExponent, isIsoDate, type Sport } from '@booking/shared';

export type Criteria = {
  near: { lat: number; lng: number } | null;
  radiusKm: number | null; // null = any distance
  sport: Sport | null;
  indoor: boolean | null;
  date: string | null; // null = each venue's today
  from: string | null;
  to: string | null;
  currency: string | null;
  minPrice: number | null; // minor units
  maxPrice: number | null; // minor units
  available: boolean;
};

export const EMPTY_CRITERIA: Criteria = {
  near: null,
  radiusKm: null,
  sport: null,
  indoor: null,
  date: null,
  from: null,
  to: null,
  currency: null,
  minPrice: null,
  maxPrice: null,
  available: false,
};

// Same grammar as the API's query parser (apps/api/src/search/query.ts).
const DECIMAL = /^-?\d+(\.\d+)?$/;
const WHOLE = /^\d+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function decimal(v: string | null, min: number, max: number): number | null {
  if (v === null || !DECIMAL.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

function whole(v: string | null): number | null {
  if (v === null || !WHOLE.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

function flag(v: string | null): boolean | null {
  return v === 'true' ? true : v === 'false' ? false : null;
}

function validCurrency(code: string | null): string | null {
  if (code === null) return null;
  try {
    currencyExponent(code);
    return code;
  } catch {
    return null;
  }
}

/** Reads search criteria from a URL. Invalid values and broken pairs are dropped; never throws. */
export function criteriaFromParams(p: URLSearchParams): Criteria {
  const lat = decimal(p.get('lat'), -90, 90);
  const lng = decimal(p.get('lng'), -180, 180);
  const near = lat !== null && lng !== null ? { lat, lng } : null;

  const radius = decimal(p.get('radiusKm'), 0, MAX_SEARCH_RADIUS_KM);
  const radiusKm = near && radius !== null && radius > 0 ? radius : null;

  const sportParam = p.get('sport');
  const sport = (SPORTS as readonly string[]).includes(sportParam ?? '') ? (sportParam as Sport) : null;

  const dateParam = p.get('date');
  const date = dateParam !== null && isIsoDate(dateParam) ? dateParam : null;

  const fromParam = p.get('from');
  const toParam = p.get('to');
  const rangeOk = fromParam !== null && toParam !== null && TIME.test(fromParam) && TIME.test(toParam) && fromParam !== toParam;

  const currency = validCurrency(p.get('currency'));
  let minPrice = currency ? whole(p.get('minPrice')) : null;
  let maxPrice = currency ? whole(p.get('maxPrice')) : null;
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    minPrice = null;
    maxPrice = null;
  }

  return {
    near,
    radiusKm,
    sport,
    indoor: flag(p.get('indoor')),
    date,
    from: rangeOk ? fromParam : null,
    to: rangeOk ? toParam : null,
    currency,
    minPrice,
    maxPrice,
    available: p.get('available') === 'true',
  };
}

/** Writes criteria with the API's parameter names; nulls and false are omitted. */
export function criteriaToParams(c: Criteria): URLSearchParams {
  const p = new URLSearchParams();
  if (c.near) {
    p.set('lat', String(c.near.lat));
    p.set('lng', String(c.near.lng));
    if (c.radiusKm !== null) p.set('radiusKm', String(c.radiusKm));
  }
  if (c.sport) p.set('sport', c.sport);
  if (c.indoor !== null) p.set('indoor', String(c.indoor));
  if (c.date) p.set('date', c.date);
  if (c.from && c.to) {
    p.set('from', c.from);
    p.set('to', c.to);
  }
  if (c.currency) p.set('currency', c.currency);
  if (c.minPrice !== null) p.set('minPrice', String(c.minPrice));
  if (c.maxPrice !== null) p.set('maxPrice', String(c.maxPrice));
  if (c.available) p.set('available', 'true');
  return p;
}

/** Query string for GET /search. */
export function apiQuery(c: Criteria, cursor: number, limit = 20): string {
  const p = new URLSearchParams({ limit: String(limit), cursor: String(cursor) });
  for (const [k, v] of criteriaToParams(c)) p.set(k, v);
  return `?${p.toString()}`;
}
