import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLanes, courtUsage, freeGaps } from '../../src/owner/today/CourtTimeline';
import type { OwnerSlot } from '../../src/owner/types';
import { ownerBooking, slotDay, turf } from './fixtures';

const TZ = 'Asia/Dhaka'; // UTC+6

describe('buildLanes', () => {
  it('groups live bookings by court in venue time and skips dead ones', () => {
    const { lanes, from, to } = buildLanes(
      [
        ownerBooking({ id: 'a', turfId: 't2', turf: { name: 'Court B' }, status: 'confirmed', paymentStatus: 'paid' }),
        ownerBooking({ id: 'b', turfId: 't1', turf: { name: 'Court A' }, status: 'pending' }),
        ownerBooking({ id: 'c', turfId: 't1', turf: { name: 'Court A' }, status: 'confirmed', source: 'walkin', paymentStatus: 'paid' }),
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

  it('colours by status and carries money due separately', () => {
    const { lanes } = buildLanes(
      [
        ownerBooking({ id: 'online', status: 'confirmed', paymentStatus: 'unpaid' }),
        ownerBooking({ id: 'walk', status: 'confirmed', source: 'walkin', paymentStatus: 'partially_paid', amountPaid: 400 }),
        ownerBooking({ id: 'done', status: 'completed', paymentStatus: 'unpaid' }),
        ownerBooking({ id: 'free', status: 'confirmed', paymentStatus: 'unpaid', total: 0 }),
      ],
      TZ,
    );
    const blocks = lanes[0]!.blocks;
    expect(blocks.map((b) => `${b.id}:${b.kind}`)).toEqual(['online:ok', 'walk:walk', 'done:ok', 'free:ok']);
    expect(blocks.map((b) => b.due)).toEqual([1000, 600, 1000, 0]);
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

/** One-hour slots in venue time, e.g. hourSlots(9, 12) -> 09:00, 10:00, 11:00. */
const hourSlots = (from: number, to: number, blocked: number[] = [], status: Record<number, OwnerSlot['status']> = {}): OwnerSlot[] =>
  Array.from({ length: to - from }, (_, i) => {
    const h = from + i;
    const hm = (x: number) => `${String(x % 24).padStart(2, '0')}:00`;
    return {
      startAt: `2026-10-26T${String(h - 6).padStart(2, '0')}:00:00.000Z`,
      endAt: `2026-10-26T${String(h - 5).padStart(2, '0')}:00:00.000Z`,
      localStart: hm(h),
      localEnd: hm(h + 1),
      price: 1000,
      status: status[h] ?? (blocked.includes(h) ? 'blocked' : 'available'),
      source: 'hours',
    };
  });

describe('buildLanes with court data', () => {
  const courts = {
    turfs: [turf({ id: 't1', name: 'Court A' }), turf({ id: 't2', name: 'Court B' }), turf({ id: 't3', name: 'Court C' })],
    days: {
      t1: slotDay({ slots: hourSlots(9, 22, [15]) }),
      t2: slotDay({ slots: hourSlots(7, 23) }),
      t3: slotDay({ closed: true, closedReason: 'Repairs', slots: [] }),
    },
  };

  it('gives every court a lane, widens the axis to opening hours and marks closed time', () => {
    const { lanes, from, to } = buildLanes([ownerBooking({ status: 'confirmed' })], TZ, courts);
    expect(lanes.map((l) => [l.name, l.blocks.length])).toEqual([
      ['Court A', 1],
      ['Court B', 0],
      ['Court C', 0],
    ]);
    expect([from, to]).toEqual([7, 23]);
    expect(lanes[0]!.closed).toEqual([
      [7, 9],
      [15, 16],
      [22, 23],
    ]);
    expect(lanes[1]!.closed).toEqual([]);
    expect(lanes[2]!.closed).toEqual([[7, 23]]);
  });

  it('courtUsage counts live booked hours against open, unblocked hours', () => {
    const usage = courtUsage(
      [
        ownerBooking({ id: 'a', status: 'confirmed' }), // 1h on t1
        ownerBooking({ id: 'b', turfId: 't2', status: 'pending' }), // 1h on t2
        ownerBooking({ id: 'c', status: 'cancelled' }),
      ],
      courts,
      TZ,
    );
    expect(usage).toEqual({ booked: 2, open: 12 + 16 });
    expect(courtUsage([], null, TZ)).toBeNull();
  });
});

describe('freeGaps', () => {
  it('freeGaps merges consecutive available slots and stops at taken or past ones', () => {
    const day = slotDay({ slots: hourSlots(8, 13, [], { 8: 'past', 11: 'booked' }) });
    expect(freeGaps(day)).toEqual([
      { start: 9, end: 11, startAt: '2026-10-26T03:00:00.000Z' },
      { start: 12, end: 13, startAt: '2026-10-26T06:00:00.000Z' },
    ]);
    expect(freeGaps(undefined)).toEqual([]);
  });
});

describe('free gaps on touch screens', () => {
  it('show their "+" without hover where there is no hover', () => {
    const css = readFileSync(join(__dirname, '..', '..', 'src', 'owner', 'today', 'TodayPage.module.css'), 'utf8');
    const touch = [...css.matchAll(/@media \(hover: none\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]!).join('\n');
    const gap = touch.match(/\.gap \{([^}]*)\}/)?.[1] ?? '';
    expect(gap).toMatch(/color: var\(--text-muted\)/);
    expect(gap).toMatch(/border: 1px dashed var\(--border-subtle\)/);
  });
});
