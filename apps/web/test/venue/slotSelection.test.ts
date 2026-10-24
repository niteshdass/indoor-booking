import { describe, expect, it } from 'vitest';
import { MAX_SLOTS_PER_BOOKING, type SlotStatus } from '@booking/shared';
import { keepSelectable, toggleSlot } from '../../src/venue/slotSelection';
import type { SlotJson } from '../../src/lib/types';

const BASE = Date.parse('2026-10-25T04:00:00Z');
const HALF_HOUR = 30 * 60_000;

function slot(i: number, status: SlotStatus = 'available'): SlotJson {
  return {
    startAt: new Date(BASE + i * HALF_HOUR).toISOString(),
    endAt: new Date(BASE + (i + 1) * HALF_HOUR).toISOString(),
    localStart: `s${i}`,
    localEnd: `e${i}`,
    price: 1000,
    status,
  };
}

const slots = Array.from({ length: 14 }, (_, i) => slot(i, i === 3 ? 'booked' : 'available'));
const s = (i: number) => slots[i]!.startAt;

describe('toggleSlot', () => {
  it('first click selects', () => {
    expect(toggleSlot(slots, [], s(0))).toEqual([s(0)]);
  });

  it('adjacent extends forward and backward', () => {
    expect(toggleSlot(slots, [s(4)], s(5))).toEqual([s(4), s(5)]);
    expect(toggleSlot(slots, [s(4), s(5)], s(6))).toEqual([s(4), s(5), s(6)]);
    expect(toggleSlot(slots, [s(5), s(6)], s(4))).toEqual([s(4), s(5), s(6)]);
  });

  it('non-adjacent restarts', () => {
    expect(toggleSlot(slots, [s(4), s(5)], s(8))).toEqual([s(8)]);
  });

  it('end click shrinks', () => {
    expect(toggleSlot(slots, [s(4), s(5), s(6)], s(6))).toEqual([s(4), s(5)]);
    expect(toggleSlot(slots, [s(4), s(5), s(6)], s(4))).toEqual([s(5), s(6)]);
    expect(toggleSlot(slots, [s(4)], s(4))).toEqual([]);
  });

  it('middle click restarts', () => {
    expect(toggleSlot(slots, [s(4), s(5), s(6)], s(5))).toEqual([s(5)]);
  });

  it('cannot pass a booked slot', () => {
    expect(toggleSlot(slots, [s(1), s(2)], s(4))).toEqual([s(4)]);
    expect(toggleSlot(slots, [s(1), s(2)], s(3))).toEqual([s(1), s(2)]);
  });

  it('max 12', () => {
    const many = Array.from({ length: 14 }, (_, i) => slot(i));
    const sel = many.slice(0, MAX_SLOTS_PER_BOOKING).map((x) => x.startAt);
    expect(toggleSlot(many, sel, many[12]!.startAt)).toBe(sel);
  });

  it('pending slot ignored', () => {
    const list = [slot(0), slot(1, 'pending'), slot(2)];
    const sel = [list[0]!.startAt];
    expect(toggleSlot(list, sel, list[1]!.startAt)).toBe(sel);
  });

  it('max 12 also blocks backward extension', () => {
    const many = Array.from({ length: 14 }, (_, i) => slot(i));
    const sel = many.slice(1, 1 + MAX_SLOTS_PER_BOOKING).map((x) => x.startAt);
    expect(toggleSlot(many, sel, many[0]!.startAt)).toBe(sel);
  });

  it('null price is not selectable', () => {
    const list = [slot(0), { ...slot(1), price: null }, slot(2)];
    expect(toggleSlot(list, [], list[1]!.startAt)).toEqual([]);
    const sel = [list[0]!.startAt];
    expect(toggleSlot(list, sel, list[1]!.startAt)).toBe(sel);
  });
});

describe('keepSelectable', () => {
  it('drops selections that became booked or unpriced, keeps others', () => {
    const list = [slot(0), slot(1, 'booked'), { ...slot(2), price: null }, slot(3)];
    const all = list.map((x) => x.startAt);
    expect(keepSelectable(list, all)).toEqual([]);
    expect(keepSelectable(list, [all[0]!])).toEqual([all[0]]);
  });
});
