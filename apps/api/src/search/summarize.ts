import { hmToMin, rangeCovers, type ComputedSlot, type NextFreeSlot, type TimeRange } from '@booking/shared';

export type TurfDay = { turfId: string; turfName: string; open: boolean; slots: ComputedSlot[] };
export type DayFilters = { range: TimeRange | null; minPrice: number | null; maxPrice: number | null };
export type DaySummary = { matched: number; fromPrice: number | null; nextFreeSlot: NextFreeSlot | null };

const SHOWN = new Set(['available', 'pending', 'booked']);

function matches(slot: ComputedSlot, f: DayFilters): slot is ComputedSlot & { price: number } {
  if (slot.price === null || !SHOWN.has(slot.status)) return false;
  if (f.range && !rangeCovers(f.range, hmToMin(slot.localStart))) return false;
  if (f.minPrice !== null && slot.price < f.minPrice) return false;
  if (f.maxPrice !== null && slot.price > f.maxPrice) return false;
  return true;
}

/** Folds a venue's turf days into its search summary: lowest matching price and earliest free slot. */
export function summarizeDay(turfs: TurfDay[], filters: DayFilters): DaySummary {
  let matched = 0;
  let fromPrice: number | null = null;
  let next: { turf: TurfDay; slot: ComputedSlot & { price: number } } | null = null;
  for (const turf of turfs) {
    if (!turf.open) continue;
    for (const slot of turf.slots) {
      if (!matches(slot, filters)) continue;
      matched++;
      if (fromPrice === null || slot.price < fromPrice) fromPrice = slot.price;
      if (slot.status !== 'available') continue;
      const diff = next ? slot.startAt.getTime() - next.slot.startAt.getTime() : -1;
      if (!next || diff < 0 || (diff === 0 && turf.turfName < next.turf.turfName)) next = { turf, slot };
    }
  }
  return {
    matched,
    fromPrice,
    nextFreeSlot: next && {
      turfId: next.turf.turfId,
      turfName: next.turf.turfName,
      startAt: next.slot.startAt.toISOString(),
      endAt: next.slot.endAt.toISOString(),
      localStart: next.slot.localStart,
      localEnd: next.slot.localEnd,
      price: next.slot.price,
    },
  };
}
