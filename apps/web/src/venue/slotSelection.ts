import { MAX_SLOTS_PER_BOOKING } from '@booking/shared';
import type { SlotJson } from '../lib/types';

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

  if (slot.status !== 'available') return selected;
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
