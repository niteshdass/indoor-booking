import { quoteAddons, type AddonLine, type AddonSelection, type OfferedAddon } from '@booking/shared';
import type { OwnerSlot, WalkInAddon } from '../types';

export type WalkInEstimate = { slotsTotal: number; addons: AddonLine[]; total: number };

/**
 * Client-side price preview for the picked slots. Null when nothing is picked or a picked slot has no price; the
 * server still sets the final price. Reuses the shared add-on maths so per_hour rounding and auto lines match.
 */
export function walkInEstimate(input: {
  slots: OwnerSlot[];
  offered: WalkInAddon[];
  indoor: boolean;
  selection: AddonSelection[];
}): WalkInEstimate | null {
  const { slots, offered, indoor, selection } = input;
  if (slots.length === 0) return null;
  let slotsTotal = 0;
  for (const s of slots) {
    if (s.price === null) return null;
    slotsTotal += s.price;
  }
  const offeredAddons: OfferedAddon[] = offered.map((a) => ({
    addonId: a.id,
    name: a.name,
    pricingType: a.pricingType,
    unitPrice: a.unitPrice,
    maxQuantity: a.maxQuantity,
    stock: null,
    autoApply: a.autoApply,
  }));
  try {
    const { lines, total } = quoteAddons({
      offered: offeredAddons,
      slots: slots.map((s) => ({ startAt: new Date(s.startAt), endAt: new Date(s.endAt), localStart: s.localStart })),
      indoor,
      selection,
    });
    return { slotsTotal, addons: lines, total: slotsTotal + total };
  } catch {
    // An invalid selection (e.g. a stale add-on) has no estimate; the server reports the real error on submit.
    return null;
  }
}
