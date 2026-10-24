import { describe, expect, it } from 'vitest';
import type { SearchResult } from '@booking/shared';
import { buildPin, makePinIcon, pinLabel, roundAndWrap, shouldFit } from '../../src/search/ResultsMap';
import { money } from '../../src/lib/format';

const r: SearchResult = {
  slug: 'a',
  name: 'Arena One',
  address: 'Road 1',
  city: 'Dhaka',
  country: 'BD',
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
  location: { lat: 1, lng: 2 },
  photo: null,
  sports: ['futsal'],
  distanceMeters: null,
  date: '2026-10-25',
  fromPrice: 1000,
  nextFreeSlot: null,
};

describe('pinLabel', () => {
  it('is the formatted price when there is one', () => {
    expect(pinLabel(r, 'en')).toBe(money(1000, 'BDT', 'en'));
  });
  it('is the venue name when there is no price', () => {
    expect(pinLabel({ ...r, fromPrice: null }, 'en')).toBe('Arena One');
  });
});

describe('buildPin', () => {
  it('renders an untrusted venue name as text, never markup', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const el = buildPin(pinLabel({ ...r, name: evil, fromPrice: null }, 'en'), 'pin');
    expect(el.querySelector('img')).toBeNull();
    expect(el.children).toHaveLength(0);
    expect(el.textContent).toBe(evil);
  });
});

describe('makePinIcon', () => {
  it('passes a DOM element, not a string, and the name stays text', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const icon = makePinIcon({ ...r, name: evil, fromPrice: null }, 'en');
    const html = icon.options.html;
    expect(html).toBeInstanceOf(Element);
    const el = html as HTMLElement;
    expect(el.textContent).toBe(evil);
    expect(el.querySelector('img')).toBeNull();
  });
});

describe('roundAndWrap', () => {
  it('turns -0 into 0', () => {
    expect(String(roundAndWrap({ lat: -0, lng: -0.000001 }).lat)).toBe('0');
    expect(String(roundAndWrap({ lat: -0.000001, lng: -0.000001 }).lng)).toBe('0');
  });
  it('keeps 180 and wraps beyond it', () => {
    expect(roundAndWrap({ lat: 0, lng: 180 }).lng).toBe(180);
    expect(roundAndWrap({ lat: 0, lng: 190 }).lng).toBe(-170);
    expect(roundAndWrap({ lat: 0, lng: -190 }).lng).toBe(170);
  });
  it('never uses exponent notation', () => {
    const c = roundAndWrap({ lat: 0.000001, lng: 0.00001234 });
    expect(`${c.lat}${c.lng}`).not.toMatch(/e/i);
    expect(c).toEqual({ lat: 0, lng: 0.00001 });
  });
});

describe('shouldFit', () => {
  it('fits a first result set', () => expect(shouldFit([], ['a', 'b'])).toBe(true));
  it('does not fit when pages are appended', () => expect(shouldFit(['a', 'b'], ['a', 'b', 'c'])).toBe(false));
  it('does not fit an identical set (language change)', () => expect(shouldFit(['a'], ['a'])).toBe(false));
  it('does not fit while results are empty (refetch)', () => expect(shouldFit(['a'], [])).toBe(false));
  it('fits a different set', () => expect(shouldFit(['a', 'b'], ['x', 'y'])).toBe(true));
});
