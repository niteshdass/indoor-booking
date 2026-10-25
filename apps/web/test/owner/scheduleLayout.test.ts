import { describe, expect, it } from 'vitest';
import { scheduleLayout } from '../../src/owner/schedule/scheduleLayout';
import type { OwnerSlot } from '../../src/owner/types';
import { ownerBooking, slotDay, turf } from './fixtures';

const slot = (startAt: string, endAt: string): OwnerSlot => ({
  startAt,
  endAt,
  localStart: '00:00',
  localEnd: '00:00',
  price: 1000,
  status: 'available',
  source: 'hours',
});

describe('scheduleLayout', () => {
  it('places after-midnight slots after the evening ones', () => {
    const day = slotDay({
      slots: [
        slot('2026-10-26T17:00:00.000Z', '2026-10-26T18:00:00.000Z'),
        slot('2026-10-26T18:00:00.000Z', '2026-10-26T19:00:00.000Z'),
        slot('2026-10-26T19:00:00.000Z', '2026-10-26T20:00:00.000Z'),
      ],
    });
    // 23:00, 00:00 and 01:00 in Asia/Dhaka (UTC+6)
    const layout = scheduleLayout([turf()], { t1: day }, []);
    const rows = layout.columns[0]!.cells.map((c) => c.row);
    expect(rows).toEqual([1, 5, 9]);
    expect(layout.rows).toBe(12);
    expect(layout.labels.map((l) => l.row)).toEqual([1, 3, 5, 7, 9, 11]);
  });

  it('merges a two-slot booking into one cell and drops its slot cells', () => {
    const day = slotDay({
      slots: [
        slot('2026-10-26T04:00:00.000Z', '2026-10-26T05:00:00.000Z'),
        slot('2026-10-26T05:00:00.000Z', '2026-10-26T06:00:00.000Z'),
        slot('2026-10-26T06:00:00.000Z', '2026-10-26T07:00:00.000Z'),
      ],
    });
    const b = ownerBooking({
      status: 'confirmed',
      slots: [
        { startAt: '2026-10-26T04:00:00.000Z', endAt: '2026-10-26T05:00:00.000Z', price: 1 },
        { startAt: '2026-10-26T05:00:00.000Z', endAt: '2026-10-26T06:00:00.000Z', price: 1 },
      ],
    });
    const cells = scheduleLayout([turf()], { t1: day }, [b]).columns[0]!.cells;
    expect(cells.map((c) => [c.kind, c.row, c.span])).toEqual([
      ['booking', 1, 8],
      ['slot', 9, 4],
    ]);
  });

  it('aligns turfs with different slot lengths on a 15-minute grid', () => {
    const half = slotDay({
      slots: [
        slot('2026-10-26T04:00:00.000Z', '2026-10-26T04:30:00.000Z'),
        slot('2026-10-26T04:30:00.000Z', '2026-10-26T05:00:00.000Z'),
      ],
    });
    const hour = slotDay({ slots: [slot('2026-10-26T04:30:00.000Z', '2026-10-26T05:30:00.000Z')] });
    const layout = scheduleLayout([turf(), turf({ id: 't2' })], { t1: half, t2: hour }, []);
    expect(layout.rows).toBe(6);
    expect(layout.columns[0]!.cells.map((c) => [c.row, c.span])).toEqual([[1, 2], [3, 2]]);
    expect(layout.columns[1]!.cells.map((c) => [c.row, c.span])).toEqual([[3, 4]]);
  });

  it('closed turf has no cells and keeps its reason', () => {
    const closed = slotDay({ closed: true, closedReason: 'Maintenance' });
    const layout = scheduleLayout([turf(), turf({ id: 't2' })], { t1: closed, t2: slotDay() }, []);
    expect(layout.columns[0]).toMatchObject({ closed: true, closedReason: 'Maintenance', cells: [] });
    expect(layout.columns[1]!.cells).toHaveLength(1);
  });

  it('cancelled booking leaves its slots as slot cells', () => {
    const layout = scheduleLayout([turf()], { t1: slotDay() }, [ownerBooking({ status: 'cancelled' })]);
    expect(layout.columns[0]!.cells.map((c) => c.kind)).toEqual(['slot']);
  });

  it('has no rows when no turf has slots', () => {
    expect(scheduleLayout([turf()], { t1: slotDay({ slots: [] }) }, []).rows).toBe(0);
  });
});
