import { describe, expect, it } from 'vitest';
import type { SearchResult } from '@booking/shared';
import { buildPin, makePinIcon, pinLabel, roundAndWrap, shouldFit, viewAction } from '../../src/search/ResultsMap';
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
  rating: null,
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

describe('shouldFit(fittedKey, key, count)', () => {
  it('fits the first non-empty set', () => expect(shouldFit(null, 'a', 3)).toBe(true));
  it('does not fit an append under the same key (load more)', () => expect(shouldFit('a', 'a', 5)).toBe(false));
  it('fits a new key whose results extend the previous list (wider radius)', () => expect(shouldFit('radius=10', 'radius=30', 8)).toBe(true));
  it('waits while a new key has no results, then fits once they arrive', () => {
    expect(shouldFit('a', 'b', 0)).toBe(false);
    expect(shouldFit('a', 'b', 4)).toBe(true);
  });
  it('does not fit on a language change (same key)', () => expect(shouldFit('a', 'a', 3)).toBe(false));
});

describe('viewAction', () => {
  const base = { fittedKey: null, centeredKey: null, key: 'k', count: 0, hasCenter: true, atCenter: false };
  it('fits non-empty results of a new key', () => expect(viewAction({ ...base, count: 3 })).toBe('fit'));
  it('centres an empty result set of a new key', () => expect(viewAction(base)).toBe('center'));
  it('does not centre twice for the same key', () => expect(viewAction({ ...base, centeredKey: 'k' })).toBe('none'));
  it('does not move a map that is already at the centre (keeps the user zoom)', () => expect(viewAction({ ...base, atCenter: true })).toBe('mark'));
  it('does not centre without a centre (no world-view flash)', () => expect(viewAction({ ...base, hasCenter: false })).toBe('none'));
  it('fits results that arrive after the key was centred', () => expect(viewAction({ ...base, centeredKey: 'k', count: 2 })).toBe('fit'));
});
