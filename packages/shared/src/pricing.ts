import { rangeMinutes } from './time';

export type TimeRange = { start: string; end: string };

export type PricingRule =
  | { kind: 'date'; date: string; range?: TimeRange; price: number }
  | { kind: 'weekend'; range?: TimeRange; price: number }
  | { kind: 'weekday'; range?: TimeRange; price: number };

export type TurfPricing = { base: number; rules: PricingRule[] };

const WHOLE_DAY: [number, number] = [0, 2880];

function minutesOf(rule: PricingRule): [number, number] {
  return rule.range ? rangeMinutes(rule.range) : WHOLE_DAY;
}

/** Rule ranges are times of day, so they match modulo 1440: m, m+1440 or m-1440 may fall in [s, e). */
function covers([s, e]: [number, number], m: number): boolean {
  return (s <= m && m < e) || (s <= m + 1440 && m + 1440 < e) || (s <= m - 1440 && m - 1440 < e);
}

function overlaps([as, ae]: [number, number], [bs, be]: [number, number]): boolean {
  return [0, 1440, -1440].some((d) => as < be + d && bs + d < ae);
}

/** First tier with a matching rule wins: date, weekend, weekday, base. minute is in [0, 2880). */
export function priceFor(
  pricing: TurfPricing,
  at: { businessDate: string; weekend: boolean; minute: number },
): number {
  const tiers: Array<(r: PricingRule) => boolean> = [
    (r) => r.kind === 'date' && r.date === at.businessDate,
    (r) => r.kind === 'weekend' && at.weekend,
    (r) => r.kind === 'weekday' && !at.weekend,
  ];
  for (const inTier of tiers) {
    for (const rule of pricing.rules) {
      if (!inTier(rule)) continue;
      if (covers(minutesOf(rule), at.minute)) return rule.price;
    }
  }
  return pricing.base;
}

function sameTier(a: PricingRule, b: PricingRule): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'date' || a.date === (b as typeof a).date;
}

/** Indexes [i, j] (i < j) of the first pair of same-tier rules whose ranges overlap, or null. */
export function pricingConflict(rules: PricingRule[]): [number, number] | null {
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i]!;
      const b = rules[j]!;
      if (!sameTier(a, b)) continue;
      if (overlaps(minutesOf(a), minutesOf(b))) return [i, j];
    }
  }
  return null;
}
