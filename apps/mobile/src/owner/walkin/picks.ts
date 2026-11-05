import { runsOf, type AddonLine, type SlotDay } from '@booking/shared';
import type { OwnerSlot, OwnerSlotDay, OwnerTurf } from '../types';
import type { WalkInEstimate } from './walkInEstimate';

/** Mirrors the helpers of apps/web/src/owner/walkin/WalkInPage.tsx. */

/** Picked slot starts per court, then per date. */
export type Picks = Record<string, Record<string, string[]>>;
/** One booking: a run of consecutive slots on one day of one court. */
export type Run = { turfId: string; date: string; slots: OwnerSlot[] };

/** Cache key of one day of one court. */
export const cell = (turfId: string, date: string) => `${turfId}|${date}`;

/** `picks` with one court's day set to `list` (dropped when empty). */
export function withDay(picks: Picks, turfId: string, date: string, list: string[]): Picks {
  const days = { ...(picks[turfId] ?? {}) };
  if (list.length > 0) days[date] = [...list].sort();
  else delete days[date];
  const next = { ...picks };
  if (Object.keys(days).length > 0) next[turfId] = days;
  else delete next[turfId];
  return next;
}

/** Every picked run, courts in card order, then by day and time; days not loaded yet are left out. */
export function runsFor(turfs: OwnerTurf[], picks: Picks, days: Record<string, OwnerSlotDay>): Run[] {
  return turfs.flatMap(({ id }) =>
    Object.keys(picks[id] ?? {})
      .sort()
      .flatMap((d) => {
        const day = days[cell(id, d)];
        return day ? runsOf(day.slots, picks[id]![d]!).map((slots) => ({ turfId: id, date: d, slots })) : [];
      }),
  );
}

/** The estimates of several bookings as one: totals summed, the same add-on line merged. */
export function combine(list: WalkInEstimate[]): WalkInEstimate {
  const lines = new Map<string, AddonLine>();
  for (const e of list) {
    for (const l of e.addons) {
      const key = `${l.addonId}-${l.auto}`;
      const seen = lines.get(key);
      lines.set(key, seen ? { ...seen, quantity: seen.quantity + l.quantity, total: seen.total + l.total } : l);
    }
  }
  return {
    slotsTotal: list.reduce((n, e) => n + e.slotsTotal, 0),
    addons: [...lines.values()],
    total: list.reduce((n, e) => n + e.total, 0),
  };
}

export const gridDayOf = (d: OwnerSlotDay): SlotDay => ({
  businessDate: d.businessDate,
  currency: d.currency,
  status: !d.inWindow ? 'outside_window' : d.closed ? 'closed' : 'open',
  slots: d.slots,
});
