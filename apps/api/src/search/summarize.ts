import { FREE_TIMES_SHOWN, hmToMin, rangeCovers, type ComputedSlot, type NextFreeSlot, type TimeRange } from '@booking/shared';

export type TurfDay = { turfId: string; turfName: string; open: boolean; slots: ComputedSlot[] };
export type DayFilters = { range: TimeRange | null; minPrice: number | null; maxPrice: number | null };
export type DaySummary = {
  matched: number;
  fromPrice: number | null;
  nextFreeSlot: NextFreeSlot | null;
  freeTimes: NextFreeSlot[];
  freeTimeCount: number;
};

const SHOWN = new Set(['available', 'pending', 'booked']);

function matches(slot: ComputedSlot, f: DayFilters): slot is ComputedSlot & { price: number } {
  if (slot.price === null || !SHOWN.has(slot.status)) return false;
  if (f.range && !rangeCovers(f.range, hmToMin(slot.localStart))) return false;
  if (f.minPrice !== null && slot.price < f.minPrice) return false;
  if (f.maxPrice !== null && slot.price > f.maxPrice) return false;
  return true;
}

type Free = { turf: TurfDay; slot: ComputedSlot & { price: number } };

function freeJson({ turf, slot }: Free): NextFreeSlot {
  return {
    turfId: turf.turfId,
    turfName: turf.turfName,
    startAt: slot.startAt.toISOString(),
    endAt: slot.endAt.toISOString(),
    localStart: slot.localStart,
    localEnd: slot.localEnd,
    price: slot.price,
  };
}

/**
 * Folds a venue's turf days into its search summary: lowest matching price and the free start times,
 * earliest first. Two courts free at the same time are one start time, listed on the court that sorts first.
 */
export function summarizeDay(turfs: TurfDay[], filters: DayFilters): DaySummary {
  let matched = 0;
  let fromPrice: number | null = null;
  const free = new Map<number, Free>();
  for (const turf of turfs) {
    if (!turf.open) continue;
    for (const slot of turf.slots) {
      if (!matches(slot, filters)) continue;
      matched++;
      if (fromPrice === null || slot.price < fromPrice) fromPrice = slot.price;
      if (slot.status !== 'available') continue;
      const at = slot.startAt.getTime();
      const seen = free.get(at);
      if (!seen || turf.turfName < seen.turf.turfName) free.set(at, { turf, slot });
    }
  }
  const freeTimes = [...free.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, FREE_TIMES_SHOWN)
    .map(([, f]) => freeJson(f));
  return { matched, fromPrice, nextFreeSlot: freeTimes[0] ?? null, freeTimes, freeTimeCount: free.size };
}
