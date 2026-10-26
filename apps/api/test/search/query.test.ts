import { describe, it, expect } from 'vitest';
import { SEARCH_RADII_KM } from '@booking/shared';
import { AppError } from '../../src/errors';
import { parseSearchQuery } from '../../src/search/query';

function failure(q: unknown): AppError {
  try {
    parseSearchQuery(q);
  } catch (err) {
    return err as AppError;
  }
  throw new Error(`expected ${JSON.stringify(q)} to be rejected`);
}

describe('parseSearchQuery', () => {
  it('defaults: anywhere, no filters', () => {
    expect(parseSearchQuery({})).toEqual({
      near: null,
      radiusKm: null,
      bbox: null,
      sport: null,
      indoor: null,
      date: null,
      range: null,
      currency: null,
      minPrice: null,
      maxPrice: null,
      available: false,
      limit: 20,
      cursor: 0,
      sort: 'default',
    });
  });

  it('parses every filter', () => {
    expect(
      parseSearchQuery({
        lat: '23.81',
        lng: '90.41',
        radiusKm: '12.5',
        sport: 'futsal',
        indoor: 'false',
        date: '2026-01-02',
        from: '22:00',
        to: '02:00',
        currency: 'BDT',
        minPrice: '500',
        maxPrice: '2000',
        available: 'true',
        limit: '5',
        cursor: '40',
        sort: 'rating',
      }),
    ).toEqual({
      near: { lat: 23.81, lng: 90.41 },
      radiusKm: 12.5,
      bbox: null,
      sport: 'futsal',
      indoor: false,
      date: '2026-01-02',
      range: { start: '22:00', end: '02:00' },
      currency: 'BDT',
      minPrice: 500,
      maxPrice: 2000,
      available: true,
      limit: 5,
      cursor: 40,
      sort: 'rating',
    });
  });

  it('parses a map box, including one across the antimeridian', () => {
    expect(parseSearchQuery({ bbox: '90.3,23.7,90.5,23.9' }).bbox).toEqual({ west: 90.3, south: 23.7, east: 90.5, north: 23.9 });
    expect(parseSearchQuery({ bbox: '170,-10,-170,10' }).bbox).toEqual({ west: 170, south: -10, east: -170, north: 10 });
  });

  it.each([
    ['three numbers', '1,2,3'],
    ['not numbers', 'a,b,c,d'],
    ['blank part', '1,,3,4'],
    ['latitude out of range', '0,-91,1,1'],
    ['longitude out of range', '-181,0,1,1'],
    ['south above north', '0,10,1,5'],
    ['no width', '5,0,5,1'],
  ])('rejects a bad box: %s', (_, bbox) => {
    expect(failure({ bbox }).code).toBe('validation_error');
  });

  it('price range needs a currency', () => {
    const err = failure({ minPrice: '500' });
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('validation_error');
  });

  it.each<[string, Record<string, unknown>]>([
    ['lat without lng', { lat: '1' }],
    ['radius without location', { radiusKm: '10' }],
    ['zero radius', { lat: '1', lng: '2', radiusKm: '0' }],
    ['radius over the cap', { lat: '1', lng: '2', radiusKm: '501' }],
    ['latitude out of range', { lat: '91', lng: '0' }],
    ['empty latitude', { lat: '', lng: '0' }],
    ['unknown sport', { sport: 'chess' }],
    ['indoor not a boolean', { indoor: 'yes' }],
    ['impossible date', { date: '2026-02-30' }],
    ['from without to', { from: '10:00' }],
    ['empty time range', { from: '10:00', to: '10:00' }],
    ['bad time', { from: '25:00', to: '10:00' }],
    ['unknown currency', { currency: 'XYZ' }],
    ['fractional price', { currency: 'BDT', minPrice: '1.5' }],
    ['min above max', { currency: 'BDT', minPrice: '900', maxPrice: '100' }],
    ['limit zero', { limit: '0' }],
    ['limit over 50', { limit: '51' }],
    ['negative cursor', { cursor: '-1' }],
    ['unknown key', { radius: '10' }],
    ['repeated key', { sport: ['football', 'futsal'] }],
  ])('rejects bad input: %s', (_name, q) => {
    const err = failure(q);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('validation_error');
  });

  it('shared radius presets', () => {
    expect(SEARCH_RADII_KM).toEqual([10, 20, 30]);
  });
});
