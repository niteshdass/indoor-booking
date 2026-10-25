import type { OwnerBooking, OwnerSlot, OwnerSlotDay, OwnerTurf } from '../types';

export const ROW_MS = 15 * 60_000;

export type Cell =
  | { kind: 'booking'; booking: OwnerBooking; row: number; span: number }
  | { kind: 'slot'; slot: OwnerSlot; row: number; span: number };

export type Layout = {
  originMs: number;
  rows: number;
  labels: { row: number; ms: number }[];
  columns: { turf: OwnerTurf; closed: boolean; closedReason: string | null; cells: Cell[] }[];
};

const DEAD = new Set(['cancelled', 'rejected', 'expired']);

/**
 * Places every turf's slots and bookings on one shared 15-minute grid (rows are 1-based). A live booking becomes one
 * cell from its first slot's start to its last slot's end and replaces the slot cells it covers.
 */
export function scheduleLayout(turfs: OwnerTurf[], days: Record<string, OwnerSlotDay>, bookings: OwnerBooking[]): Layout {
  let originMs = Infinity;
  let endMs = -Infinity;
  for (const turf of turfs) {
    for (const s of days[turf.id]?.slots ?? []) {
      originMs = Math.min(originMs, Date.parse(s.startAt));
      endMs = Math.max(endMs, Date.parse(s.endAt));
    }
  }
  if (!Number.isFinite(originMs)) return { originMs: 0, rows: 0, labels: [], columns: turfs.map(emptyColumn(days)) };

  const rows = Math.ceil((endMs - originMs) / ROW_MS);
  const labels = Array.from({ length: Math.ceil(rows / 2) }, (_, i) => ({ row: i * 2 + 1, ms: originMs + i * 2 * ROW_MS }));
  const live = bookings.filter((b) => !DEAD.has(b.status) && b.slots.length > 0);

  const columns = turfs.map((turf) => {
    const day = days[turf.id];
    const closed = day?.closed ?? false;
    const base = { turf, closed, closedReason: day?.closedReason ?? null };
    if (!day || closed) return { ...base, cells: [] };

    const cells: Cell[] = [];
    const covered = new Set<number>();
    for (const booking of live.filter((b) => b.turfId === turf.id)) {
      const starts = booking.slots.map((s) => Date.parse(s.startAt));
      const start = Math.min(...starts);
      const end = Math.max(...booking.slots.map((s) => Date.parse(s.endAt)));
      for (const s of starts) covered.add(s);
      cells.push({ kind: 'booking', booking, row: (start - originMs) / ROW_MS + 1, span: (end - start) / ROW_MS });
    }
    for (const slot of day.slots) {
      const start = Date.parse(slot.startAt);
      if (covered.has(start)) continue;
      cells.push({ kind: 'slot', slot, row: (start - originMs) / ROW_MS + 1, span: (Date.parse(slot.endAt) - start) / ROW_MS });
    }
    cells.sort((a, b) => a.row - b.row);
    return { ...base, cells };
  });
  return { originMs, rows, labels, columns };
}

function emptyColumn(days: Record<string, OwnerSlotDay>) {
  return (turf: OwnerTurf) => ({
    turf,
    closed: days[turf.id]?.closed ?? false,
    closedReason: days[turf.id]?.closedReason ?? null,
    cells: [],
  });
}
