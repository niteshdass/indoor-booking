import { MAX_SLOTS_PER_BOOKING } from '@booking/shared';
import type { SlotJson } from '../lib/types';

export function isSelectable(s: SlotJson): boolean {
  return s.status === 'available' && s.price !== null;
}

/** The part of `selected` that is still selectable in a fresh slot list; all-or-nothing keeps the run valid. */
export function keepSelectable(slots: SlotJson[], selected: string[]): string[] {
  const ok = new Set(slots.filter(isSelectable).map((s) => s.startAt));
  return selected.every((x) => ok.has(x)) ? selected : [];
}

/**
 * Next selection after clicking `startAt`. `selected` holds startAt values sorted ascending and forming one
 * consecutive run. Only available slots can be selected; the run never exceeds MAX_SLOTS_PER_BOOKING.
 */
export function toggleSlot(slots: SlotJson[], selected: string[], startAt: string): string[] {
  const slot = slots.find((s) => s.startAt === startAt);
  if (!slot) return selected;

  if (selected.includes(startAt)) {
    if (startAt === selected[0]) return selected.slice(1);
    if (startAt === selected[selected.length - 1]) return selected.slice(0, -1);
    return [startAt];
  }

  if (!isSelectable(slot)) return selected;
  if (selected.length === 0) return [startAt];

  const first = slots.find((s) => s.startAt === selected[0]);
  const last = slots.find((s) => s.startAt === selected[selected.length - 1]);
  if (first && slot.endAt === first.startAt) {
    return selected.length >= MAX_SLOTS_PER_BOOKING ? selected : [startAt, ...selected];
  }
  if (last && slot.startAt === last.endAt) {
    return selected.length >= MAX_SLOTS_PER_BOOKING ? selected : [...selected, startAt];
  }
  return [startAt];
}

/**
 * The picked slots of one day as bookings: consecutive runs in time order, each cut at
 * MAX_SLOTS_PER_BOOKING. Picks missing from `slots` are skipped.
 */
export function runsOf(slots: SlotJson[], picked: string[]): SlotJson[][] {
  const chosen = new Set(picked);
  const runs: SlotJson[][] = [];
  let run: SlotJson[] = [];
  for (const s of [...slots].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    if (!chosen.has(s.startAt)) continue;
    const prev = run[run.length - 1];
    if (prev && (prev.endAt !== s.startAt || run.length >= MAX_SLOTS_PER_BOOKING)) {
      runs.push(run);
      run = [];
    }
    run.push(s);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}
