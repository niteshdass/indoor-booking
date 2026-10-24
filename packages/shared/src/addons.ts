import { assertMinor } from './money';
import { rangeCovers, type TimeRange } from './pricing';
import { hmToMin } from './time';

export const ADDON_PRICING_TYPES = ['per_booking', 'per_unit', 'per_hour'] as const;
export type AddonPricingType = (typeof ADDON_PRICING_TYPES)[number];

export type AutoApplyRule = { range?: TimeRange; outdoorOnly: boolean };

export type OfferedAddon = {
  addonId: string;
  name: string;
  pricingType: AddonPricingType;
  unitPrice: number;
  maxQuantity: number;
  /** Units available at once; null = unlimited. */
  stock: number | null;
  autoApply: AutoApplyRule | null;
};

/** Omitted quantity means 1. */
export type AddonSelection = { addonId: string; quantity?: number };

export type QuoteSlot = { startAt: Date; endAt: Date; localStart: string };

export type AddonLine = {
  addonId: string;
  name: string;
  pricingType: AddonPricingType;
  unitPrice: number;
  quantity: number;
  /** Billed minutes, per_hour only. */
  minutes: number | null;
  total: number;
  auto: boolean;
};

export class AddonQuoteError extends Error {
  constructor(
    public code: 'addon_unavailable' | 'addon_auto' | 'duplicate_addon' | 'invalid_quantity' | 'addon_out_of_stock',
    public addonId: string,
  ) {
    super(`Add-on ${addonId}: ${code}`);
    this.name = 'AddonQuoteError';
  }
}

/** per_hour is price x minutes / 60 rounded half up, in BigInt so large prices stay exact. */
export function addonLineTotal(
  pricingType: AddonPricingType,
  unitPrice: number,
  quantity: number,
  minutes: number,
): number {
  let total: number;
  if (pricingType === 'per_booking') total = unitPrice;
  else if (pricingType === 'per_unit') total = unitPrice * quantity;
  else total = Number((BigInt(unitPrice) * BigInt(minutes) + 30n) / 60n);
  assertMinor(total);
  return total;
}

export function autoApplies(rule: AutoApplyRule, slot: QuoteSlot, indoor: boolean): boolean {
  if (rule.outdoorOnly && indoor) return false;
  return rangeCovers(rule.range, hmToMin(slot.localStart) % 1440);
}

function elapsedMinutes(slot: QuoteSlot): number {
  return (slot.endAt.getTime() - slot.startAt.getTime()) / 60_000;
}

export function quoteAddons(input: {
  offered: OfferedAddon[];
  slots: QuoteSlot[];
  indoor: boolean;
  selection: AddonSelection[];
  inUse?: Record<string, number>;
}): { lines: AddonLine[]; total: number } {
  const { offered, slots, indoor, selection, inUse = {} } = input;
  if (slots.length === 0) throw new Error('quoteAddons needs at least one slot');

  const lines: AddonLine[] = [];
  const line = (a: OfferedAddon, quantity: number, minutes: number, auto: boolean): AddonLine => ({
    addonId: a.addonId,
    name: a.name,
    pricingType: a.pricingType,
    unitPrice: a.unitPrice,
    quantity,
    minutes: a.pricingType === 'per_hour' ? minutes : null,
    total: addonLineTotal(a.pricingType, a.unitPrice, quantity, minutes),
    auto,
  });

  for (const a of offered) {
    if (!a.autoApply) continue;
    const rule = a.autoApply;
    const matching = slots.filter((s) => autoApplies(rule, s, indoor));
    if (matching.length === 0) continue;
    lines.push(line(a, 1, matching.reduce((sum, s) => sum + elapsedMinutes(s), 0), true));
  }

  const allMinutes = slots.reduce((sum, s) => sum + elapsedMinutes(s), 0);
  const seen = new Set<string>();
  for (const sel of selection) {
    const a = offered.find((o) => o.addonId === sel.addonId);
    if (!a) throw new AddonQuoteError('addon_unavailable', sel.addonId);
    if (a.autoApply) throw new AddonQuoteError('addon_auto', a.addonId);
    if (seen.has(a.addonId)) throw new AddonQuoteError('duplicate_addon', a.addonId);
    seen.add(a.addonId);

    const quantity = sel.quantity ?? 1;
    const max = a.pricingType === 'per_unit' ? a.maxQuantity : 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) {
      throw new AddonQuoteError('invalid_quantity', a.addonId);
    }
    const units = a.pricingType === 'per_unit' ? quantity : 1;
    if (a.stock !== null && (inUse[a.addonId] ?? 0) + units > a.stock) {
      throw new AddonQuoteError('addon_out_of_stock', a.addonId);
    }
    lines.push(line(a, quantity, allMinutes, false));
  }

  const total = lines.reduce((sum, l) => sum + l.total, 0);
  assertMinor(total);
  return { lines, total };
}
