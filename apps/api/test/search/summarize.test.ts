import { describe, it, expect } from 'vitest';
import { hmToMin, type ComputedSlot, type SlotStatus } from '@booking/shared';
import { summarizeDay, type DayFilters, type TurfDay } from '../../src/search/summarize';

const BASE = Date.parse('2026-01-01T00:00:00Z');
const MIN = 60_000;

/** A 60-minute slot; times past midnight (localStart < 08:00) sit on the next calendar day. */
function slot(localStart: string, price: number | null, status: SlotStatus = 'available'): ComputedSlot {
  const m = hmToMin(localStart);
  const minute = m < 8 * 60 ? m + 1440 : m;
  const end = (m + 60) % 1440;
  return {
    startAt: new Date(BASE + minute * MIN),
    endAt: new Date(BASE + (minute + 60) * MIN),
    localStart,
    localEnd: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`,
    price,
    status,
    source: 'hours',
  };
}

const turf = (name: string, slots: ComputedSlot[], open = true): TurfDay => ({ turfId: `id-${name}`, turfName: name, open, slots });
const none: DayFilters = { range: null, minPrice: null, maxPrice: null };

describe('summarizeDay', () => {
  it('fromPrice is the lowest matching price, booked slots included', () => {
    const both = summarizeDay([turf('A', [slot('18:00', 1500, 'booked'), slot('19:00', 1000)])], none);
    expect(both.fromPrice).toBe(1000);
    const bookedOnly = summarizeDay([turf('A', [slot('18:00', 1500, 'booked')])], none);
    expect(bookedOnly).toEqual({ matched: 1, fromPrice: 1500, nextFreeSlot: null, freeTimes: [], freeTimeCount: 0 });
  });

  it('nextFreeSlot is the earliest available slot across turfs, ties to turf name', () => {
    const s = summarizeDay(
      [turf('B', [slot('18:00', 1200)]), turf('A', [slot('19:00', 900), slot('18:00', 1100)])],
      none,
    );
    expect(s.nextFreeSlot).toEqual({
      turfId: 'id-A',
      turfName: 'A',
      startAt: '2026-01-01T18:00:00.000Z',
      endAt: '2026-01-01T19:00:00.000Z',
      localStart: '18:00',
      localEnd: '19:00',
      price: 1100,
    });
    expect(s.fromPrice).toBe(900);
    expect(s.matched).toBe(3);
  });

  it('freeTimes lists the earliest free start times once each, on the court that sorts first', () => {
    const s = summarizeDay(
      [
        turf('B', [slot('18:00', 1200), slot('21:00', 1200), slot('22:00', 1200)]),
        turf('A', [slot('19:00', 900, 'booked'), slot('20:00', 900), slot('18:00', 1100)]),
      ],
      none,
    );
    expect(s.freeTimes.map((f) => [f.localStart, f.turfName])).toEqual([
      ['18:00', 'A'],
      ['20:00', 'A'],
      ['21:00', 'B'],
    ]);
    expect(s.freeTimeCount).toBe(4);
    expect(s.nextFreeSlot).toEqual(s.freeTimes[0]);
  });

  it('past, blocked and unpriced slots never match', () => {
    const s = summarizeDay([turf('A', [slot('09:00', 1000, 'past'), slot('10:00', 1000, 'blocked'), slot('11:00', null)])], none);
    expect(s).toEqual({ matched: 0, fromPrice: null, nextFreeSlot: null, freeTimes: [], freeTimeCount: 0 });
  });

  it('a turf that is not open contributes nothing', () => {
    const s = summarizeDay([turf('A', [slot('18:00', 1000)], false)], none);
    expect(s).toEqual({ matched: 0, fromPrice: null, nextFreeSlot: null, freeTimes: [], freeTimeCount: 0 });
  });

  it('time range keeps slots starting inside it, end exclusive', () => {
    const s = summarizeDay(
      [turf('A', [slot('17:00', 700), slot('18:00', 1000), slot('19:00', 1000), slot('20:00', 600)])],
      { ...none, range: { start: '18:00', end: '20:00' } },
    );
    expect(s.matched).toBe(2);
    expect(s.fromPrice).toBe(1000);
    expect(s.nextFreeSlot?.localStart).toBe('18:00');
  });

  it('time range across midnight matches the night session', () => {
    const s = summarizeDay(
      [turf('A', [slot('21:00', 1000), slot('23:00', 1000, 'booked'), slot('01:00', 1000), slot('02:00', 1000)])],
      { ...none, range: { start: '22:00', end: '02:00' } },
    );
    expect(s.matched).toBe(2);
    expect(s.nextFreeSlot?.localStart).toBe('01:00');
    expect(s.nextFreeSlot?.startAt).toBe('2026-01-02T01:00:00.000Z');
  });

  it('price range is inclusive on both ends', () => {
    const s = summarizeDay([turf('A', [slot('18:00', 500), slot('19:00', 1000), slot('20:00', 1500)])], {
      ...none,
      minPrice: 1000,
      maxPrice: 1500,
    });
    expect(s.matched).toBe(2);
    expect(s.fromPrice).toBe(1000);
  });
});
