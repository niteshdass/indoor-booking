import { describe, expect, it } from 'vitest';
import type { SearchResult } from '@booking/shared';
import { buildPin, pinLabel } from '../../src/search/ResultsMap';
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
