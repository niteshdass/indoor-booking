import { describe, it, expect } from 'vitest';
import { priceFor, pricingConflict, type PricingRule, type TurfPricing } from '../src/pricing';

const rules: PricingRule[] = [
  { kind: 'weekday', range: { start: '18:00', end: '22:00' }, price: 1400 },
  { kind: 'weekday', range: { start: '22:00', end: '02:00' }, price: 1200 },
  { kind: 'weekend', price: 1500 },
  { kind: 'date', date: '2026-12-16', range: { start: '16:00', end: '20:00' }, price: 2000 },
];
const pricing: TurfPricing = { base: 1000, rules };

describe('priceFor', () => {
  it('resolves tiers: date > weekend > weekday > base', () => {
    const wd = { businessDate: '2026-12-15', weekend: false };
    expect(priceFor(pricing, { ...wd, minute: 1170 })).toBe(1400);
    expect(priceFor(pricing, { ...wd, minute: 1500 })).toBe(1200);
    expect(priceFor(pricing, { ...wd, minute: 600 })).toBe(1000);
    expect(priceFor(pricing, { businessDate: '2026-12-19', weekend: true, minute: 600 })).toBe(1500);
    const special = { businessDate: '2026-12-16', weekend: true };
    expect(priceFor(pricing, { ...special, minute: 1020 })).toBe(2000);
    expect(priceFor(pricing, { ...special, minute: 1260 })).toBe(1500);
  });

  it('treats ranges as half-open', () => {
    const wd = { businessDate: '2026-12-15', weekend: false };
    expect(priceFor(pricing, { ...wd, minute: 1080 })).toBe(1400);
    expect(priceFor(pricing, { ...wd, minute: 1320 })).toBe(1200);
    expect(priceFor(pricing, { ...wd, minute: 1319 })).toBe(1400);
    expect(priceFor(pricing, { ...wd, minute: 1440 })).toBe(1200);
    expect(priceFor(pricing, { ...wd, minute: 1559 })).toBe(1200);
    expect(priceFor(pricing, { ...wd, minute: 1560 })).toBe(1000);
  });
});

describe('pricingConflict', () => {
  it('returns null for non-overlapping rules', () => {
    expect(pricingConflict(rules)).toBeNull();
  });

  it('finds the first overlapping pair in the same tier', () => {
    const extra: PricingRule = { kind: 'weekday', range: { start: '21:00', end: '23:00' }, price: 1 };
    expect(pricingConflict([...rules, extra])).toEqual([0, 4]);
  });

  it('only compares date rules on the same date', () => {
    const r = { start: '10:00', end: '12:00' };
    expect(
      pricingConflict([
        { kind: 'date', date: '2026-12-16', range: r, price: 1 },
        { kind: 'date', date: '2026-12-17', range: r, price: 2 },
      ]),
    ).toBeNull();
    expect(
      pricingConflict([
        { kind: 'date', date: '2026-12-16', range: r, price: 1 },
        { kind: 'date', date: '2026-12-16', range: r, price: 2 },
      ]),
    ).toEqual([0, 1]);
  });

  it('treats a rule without range as overlapping its whole tier', () => {
    expect(
      pricingConflict([
        { kind: 'weekend', price: 1 },
        { kind: 'weekend', price: 2 },
      ]),
    ).toEqual([0, 1]);
    expect(
      pricingConflict([
        { kind: 'weekend', price: 1 },
        { kind: 'weekend', range: { start: '10:00', end: '11:00' }, price: 2 },
      ]),
    ).toEqual([0, 1]);
  });

  it('does not compare across tiers', () => {
    expect(
      pricingConflict([
        { kind: 'weekend', price: 1 },
        { kind: 'weekday', price: 2 },
      ]),
    ).toBeNull();
  });
});
