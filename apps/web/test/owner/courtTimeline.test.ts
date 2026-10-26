import { describe, expect, it } from 'vitest';
import { buildLanes } from '../../src/owner/today/CourtTimeline';
import { ownerBooking } from './fixtures';

const TZ = 'Asia/Dhaka'; // UTC+6

describe('buildLanes', () => {
  it('groups live bookings by court in venue time and skips dead ones', () => {
    const { lanes, from, to } = buildLanes(
      [
        ownerBooking({ id: 'a', turfId: 't2', turf: { name: 'Court B' }, status: 'confirmed' }),
        ownerBooking({ id: 'b', turfId: 't1', turf: { name: 'Court A' }, status: 'pending' }),
        ownerBooking({ id: 'c', turfId: 't1', turf: { name: 'Court A' }, status: 'confirmed', source: 'walkin' }),
        ownerBooking({ id: 'd', turfId: 't1', turf: { name: 'Court A' }, status: 'cancelled' }),
      ],
      TZ,
    );
    expect(lanes.map((l) => [l.name, l.blocks.map((b) => `${b.id}:${b.kind}`)])).toEqual([
      ['Court A', ['b:wait', 'c:walk']],
      ['Court B', ['a:ok']],
    ]);
    expect(lanes[0]!.blocks[0]).toMatchObject({ start: 10, end: 11 }); // 04:00Z = 10:00 in Dhaka
    expect([from, to]).toEqual([8, 23]);
  });

  it('widens the axis for early bookings and reads a midnight end as 24', () => {
    const { lanes, from, to } = buildLanes(
      [
        ownerBooking({ id: 'early', status: 'confirmed', slots: [{ startAt: '2026-10-25T23:30:00.000Z', endAt: '2026-10-26T00:30:00.000Z', price: 1 }] }),
        ownerBooking({ id: 'late', status: 'confirmed', slots: [{ startAt: '2026-10-26T17:00:00.000Z', endAt: '2026-10-26T18:00:00.000Z', price: 1 }] }),
      ],
      TZ,
    );
    expect(from).toBe(5);
    expect(to).toBe(24);
    expect(lanes[0]!.blocks.find((b) => b.id === 'late')).toMatchObject({ start: 23, end: 24 });
  });
});
