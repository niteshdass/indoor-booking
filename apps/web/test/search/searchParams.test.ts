import { describe, it, expect } from 'vitest';
import { AMENITIES, SPORTS } from '@booking/shared';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import { EMPTY_CRITERIA, apiQuery, criteriaFromParams, criteriaToParams, toBbox, type Criteria } from '../../src/search/searchParams';

const full: Criteria = {
  near: { lat: 23.8123, lng: 90.4123 },
  radiusKm: 20,
  bbox: { west: 90.3, south: 23.7, east: 90.5, north: 23.9 },
  sport: 'futsal',
  indoor: true,
  date: '2026-11-02',
  from: '18:00',
  to: '20:30',
  currency: 'USD',
  minPrice: 1000,
  maxPrice: 5050,
  available: true,
  sort: 'rating',
};
const parse = (qs: string) => criteriaFromParams(new URLSearchParams(qs));

describe('search params', () => {
  it('round-trip', () => {
    expect(criteriaFromParams(criteriaToParams(full))).toEqual(full);
    expect(criteriaFromParams(criteriaToParams(EMPTY_CRITERIA))).toEqual(EMPTY_CRITERIA);
    expect(criteriaToParams(EMPTY_CRITERIA).toString()).toBe('');
  });
  it('bbox parses and drops anything the API would reject', () => {
    expect(parse('bbox=170,-10,-170,10').bbox).toEqual({ west: 170, south: -10, east: -170, north: 10 });
    for (const bad of ['1,2,3', '1,2,3,x', '0,10,1,5', '5,0,5,1', '-181,0,1,1', '0,-91,1,1', ''])
      expect(parse(`bbox=${bad}`).bbox).toBeNull();
  });
  it('toBbox rounds, wraps and covers every longitude when a full turn wide', () => {
    expect(toBbox({ west: 90.123456, south: 23.7, east: 90.5, north: 23.9 })).toEqual({ west: 90.1235, south: 23.7, east: 90.5, north: 23.9 });
    expect(toBbox({ west: 170, south: 0, east: 190, north: 10 })).toEqual({ west: 170, south: 0, east: -170, north: 10 });
    expect(toBbox({ west: -300, south: -95, east: 300, north: 95 })).toEqual({ west: -180, south: -90, east: 180, north: 90 });
    expect(toBbox({ west: 1, south: 5, east: 2, north: 5 })).toBeNull();
  });
  it('indoor=false round-trips', () => {
    const c = { ...EMPTY_CRITERIA, indoor: false };
    expect(criteriaFromParams(criteriaToParams(c))).toEqual(c);
  });
  it('lat without lng dropped', () => {
    expect(parse('lat=23.8').near).toBeNull();
    expect(parse('lng=90.4').near).toBeNull();
  });
  it('radius without near dropped', () => {
    expect(parse('radiusKm=10').radiusKm).toBeNull();
    expect(parse('lat=1&lng=2&radiusKm=10').radiusKm).toBe(10);
  });
  it('from equal to dropped', () => {
    expect(parse('from=10:00&to=10:00')).toMatchObject({ from: null, to: null });
    expect(parse('from=10:00')).toMatchObject({ from: null, to: null });
  });
  it('price without currency dropped', () => {
    expect(parse('minPrice=100')).toMatchObject({ minPrice: null, maxPrice: null });
  });
  it('min > max dropped', () => {
    expect(parse('currency=USD&minPrice=500&maxPrice=100')).toMatchObject({ currency: null, minPrice: null, maxPrice: null });
  });
  it('currency without a price is dropped on parse', () => {
    expect(parse('currency=BDT').currency).toBeNull();
  });
  it('criteriaToParams sends currency only with a price', () => {
    expect(criteriaToParams({ ...EMPTY_CRITERIA, currency: 'BDT' }).has('currency')).toBe(false);
    expect(criteriaToParams({ ...EMPTY_CRITERIA, currency: 'BDT', maxPrice: 100 }).get('currency')).toBe('BDT');
    expect(criteriaToParams({ ...EMPTY_CRITERIA, currency: 'BDT', minPrice: 0 }).get('currency')).toBe('BDT');
  });
  it('apiQuery omits a price-less currency', () => {
    expect(apiQuery({ ...EMPTY_CRITERIA, currency: 'BDT' }, 0)).toBe('?limit=20&cursor=0');
  });
  it('garbage values dropped', () => {
    expect(parse('sport=chess').sport).toBeNull();
    expect(parse('date=2026-13-40').date).toBeNull();
    expect(parse('lat=1&lng=2&radiusKm=-5').radiusKm).toBeNull();
    expect(parse('lat=1&lng=2&radiusKm=501').radiusKm).toBeNull();
    expect(parse('lat=91&lng=2').near).toBeNull();
    expect(parse('currency=ZZZ').currency).toBeNull();
    expect(parse('currency=USD&minPrice=abc').minPrice).toBeNull();
    expect(parse('indoor=maybe').indoor).toBeNull();
  });
  it('searchParams round-trips sort and drops unknown values', () => {
    expect(criteriaToParams({ ...EMPTY_CRITERIA, sort: 'rating' }).toString()).toBe('sort=rating');
    expect(criteriaToParams({ ...EMPTY_CRITERIA, sort: 'default' }).has('sort')).toBe(false);
    expect(parse('sort=rating').sort).toBe('rating');
    expect(parse('sort=price').sort).toBe('default');
    expect(parse('sort=default').sort).toBe('default');
    expect(parse('').sort).toBe('default');
    expect(apiQuery({ ...EMPTY_CRITERIA, sort: 'rating' }, 0)).toContain('sort=rating');
    expect(apiQuery(EMPTY_CRITERIA, 0)).not.toContain('sort');
  });
  it('apiQuery of empty criteria', () => {
    expect(apiQuery(EMPTY_CRITERIA, 0)).toBe('?limit=20&cursor=0');
  });
  it('prices stay minor units', () => {
    expect(apiQuery({ ...EMPTY_CRITERIA, currency: 'USD', minPrice: 1000 }, 0)).toContain('minPrice=1000');
  });
  it('apiQuery uses the API names', () => {
    const q = new URLSearchParams(apiQuery(full, 40, 10));
    expect(q.get('lat')).toBe('23.8123');
    expect(q.get('lng')).toBe('90.4123');
    expect(q.get('limit')).toBe('10');
    expect(q.get('cursor')).toBe('40');
    expect(q.get('available')).toBe('true');
    expect(q.get('indoor')).toBe('true');
  });
});

describe('sport and amenity labels', () => {
  it('every SPORTS and AMENITIES key exists in both locales', () => {
    for (const [name, loc] of [['en', en], ['ru', ru]] as const) {
      const l = loc as unknown as { sports: Record<string, string>; amenities: Record<string, string> };
      for (const s of SPORTS) expect(l.sports[s], `${name} sports.${s}`).toBeTruthy();
      for (const a of AMENITIES) expect(l.amenities[a], `${name} amenities.${a}`).toBeTruthy();
    }
  });
});
