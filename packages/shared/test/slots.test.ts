import { describe, it, expect } from 'vitest';
import type { TurfPricing } from '../src/pricing';
import {
  computeSlots,
  generatedRanges,
  overrideAppliesOn,
  overrideDatesIntersect,
  overrideMinutes,
  type OverrideRule,
} from '../src/slots';

const pricing: TurfPricing = {
  base: 1000,
  rules: [
    { kind: 'weekday', range: { start: '18:00', end: '22:00' }, price: 1400 },
    { kind: 'weekday', range: { start: '22:00', end: '02:00' }, price: 1200 },
    { kind: 'weekend', price: 1500 },
    { kind: 'date', date: '2026-12-16', range: { start: '16:00', end: '20:00' }, price: 2000 },
  ],
};

const EARLY = new Date('2000-01-01T00:00:00Z');

function input(over: Partial<Parameters<typeof computeSlots>[0]> = {}): Parameters<typeof computeSlots>[0] {
  return {
    businessDate: '2026-10-30',
    timezone: 'Asia/Dhaka',
    hours: { open: '16:00', close: '02:00' },
    weekend: false,
    slotLengthMin: 60,
    pricing,
    overrides: [],
    closure: null,
    now: EARLY,
    ...over,
  };
}

const unique = (ds: Date[]) => new Set(ds.map((d) => d.getTime())).size;

describe('computeSlots generation', () => {
  it('cuts by slot length and drops the leftover', () => {
    const r = computeSlots(input({ slotLengthMin: 90 }));
    expect(r.closed).toBe(false);
    expect(r.slots.map((s) => s.localStart)).toEqual(['16:00', '17:30', '19:00', '20:30', '22:00', '23:30']);
    expect(r.slots.at(-1)!.localEnd).toBe('01:00');
    expect(r.slots.every((s) => s.source === 'hours' && s.status === 'available')).toBe(true);
    expect(r.slots[0]!.startAt.toISOString()).toBe('2026-10-30T10:00:00.000Z');
  });

  it('24-hour day', () => {
    const r = computeSlots(input({ hours: { open: '00:00', close: '00:00' }, slotLengthMin: 120 }));
    expect(r.slots).toHaveLength(12);
  });

  it("'closed' hours give no slots but are not a closure", () => {
    const r = computeSlots(input({ hours: 'closed' }));
    expect(r).toEqual({ businessDate: '2026-10-30', closed: false, closedReason: null, slots: [] });
  });

  it('spring-forward night', () => {
    const r = computeSlots(input({ timezone: 'Europe/London', businessDate: '2026-03-28' }));
    expect(r.slots).toHaveLength(9);
    expect(r.slots.at(-1)!.localStart).toBe('00:00');
    expect(unique(r.slots.map((s) => s.startAt))).toBe(9);
  });

  it('fall-back night', () => {
    const r = computeSlots(input({ timezone: 'Europe/London', businessDate: '2026-10-24' }));
    expect(r.slots).toHaveLength(11);
    expect(unique(r.slots.map((s) => s.startAt))).toBe(11);
    expect(r.slots.filter((s) => s.localStart === '01:00')).toHaveLength(2);
  });

  it('past-midnight slot belongs to its business day', () => {
    const r = computeSlots(input());
    const sat1 = r.slots.find((s) => s.localStart === '01:00')!;
    expect(sat1.startAt.toISOString()).toBe('2026-10-30T19:00:00.000Z');
    expect(sat1.price).toBe(1200);
    expect(r.slots[0]!.price).toBe(1000);
    expect(r.slots.find((s) => s.localStart === '18:00')!.price).toBe(1400);
  });
});

describe('computeSlots closures and overrides', () => {
  it('closure and close override', () => {
    expect(computeSlots(input({ closure: { reason: 'Eid' } }))).toEqual({
      businessDate: '2026-10-30',
      closed: true,
      closedReason: 'Eid',
      slots: [],
    });
    const c = computeSlots(input({ overrides: [{ type: 'close', reason: 'Maintenance' }] }));
    expect(c).toMatchObject({ closed: true, closedReason: 'Maintenance', slots: [] });
    const n = computeSlots(input({ overrides: [{ type: 'close' }] }));
    expect(n).toMatchObject({ closed: true, closedReason: null, slots: [] });
  });

  it('modify, add, block', () => {
    const overrides: OverrideRule[] = [
      { type: 'modify', slotStart: '17:00', start: '17:00', end: '18:30', price: 900 },
      { type: 'add', start: '20:00', end: '21:00' },
      { type: 'block', start: '16:00', end: '17:00' },
    ];
    const r = computeSlots(input({ hours: { open: '16:00', close: '20:00' }, overrides }));
    expect(r.slots.map((s) => [s.localStart, s.localEnd, s.source, s.status, s.price])).toEqual([
      ['16:00', '17:00', 'hours', 'blocked', 1000],
      ['17:00', '18:30', 'modify', 'available', 900],
      ['19:00', '20:00', 'hours', 'available', 1400],
      ['20:00', '21:00', 'add', 'available', 1400],
    ]);
  });

  it('modify without a matching slot is ignored; add works on closed hours', () => {
    const r = computeSlots(
      input({
        hours: 'closed',
        overrides: [
          { type: 'modify', slotStart: '10:00', start: '10:00', end: '11:00' },
          { type: 'add', start: '23:00', end: '01:00', price: 500 },
        ],
      }),
    );
    expect(r.closed).toBe(false);
    expect(r.slots.map((s) => [s.localStart, s.localEnd, s.source, s.price])).toEqual([['23:00', '01:00', 'add', 500]]);
  });

  it('a later hours change makes the override win over overlapping generated slots', () => {
    const r = computeSlots(
      input({ hours: { open: '16:00', close: '20:00' }, overrides: [{ type: 'add', start: '16:30', end: '17:30' }] }),
    );
    expect(r.slots.map((s) => s.localStart)).toEqual(['16:30', '18:00', '19:00']);
  });
});

describe('computeSlots status', () => {
  it('past, pending, booked, null pricing', () => {
    const base = computeSlots(input({ hours: { open: '16:00', close: '20:00' } }));
    const [a, b, c, d] = base.slots;
    const now = new Date((a!.startAt.getTime() + b!.startAt.getTime()) / 2);
    const r = computeSlots(
      input({
        hours: { open: '16:00', close: '20:00' },
        pricing: null,
        now,
        taken: [
          { startAt: new Date(c!.startAt.getTime()), status: 'pending' },
          { startAt: new Date(d!.startAt.getTime()), status: 'booked' },
        ],
        overrides: [{ type: 'block', start: '18:00', end: '20:00' }],
      }),
    );
    expect(r.slots.map((s) => s.status)).toEqual(['past', 'available', 'pending', 'booked']);
    expect(r.slots.every((s) => s.price === null)).toBe(true);
  });

  it('blocked beats past; startAt equal to now is past', () => {
    const base = computeSlots(input({ hours: { open: '16:00', close: '18:00' } }));
    const r = computeSlots(
      input({
        hours: { open: '16:00', close: '18:00' },
        now: base.slots[1]!.startAt,
        overrides: [{ type: 'block', start: '16:30', end: '16:45' }],
      }),
    );
    expect(r.slots.map((s) => s.status)).toEqual(['blocked', 'past']);
  });
});

describe('override dates', () => {
  it('overrideAppliesOn', () => {
    expect(overrideAppliesOn({ date: '2026-11-02' }, '2026-11-02')).toBe(true);
    expect(overrideAppliesOn({ date: '2026-11-02' }, '2026-11-03')).toBe(false);
    const rec = { recurrence: { weekdays: ['mon' as const], from: '2026-11-02', until: '2026-11-09' } };
    expect(overrideAppliesOn(rec, '2026-11-02')).toBe(true);
    expect(overrideAppliesOn(rec, '2026-11-09')).toBe(true);
    expect(overrideAppliesOn(rec, '2026-11-16')).toBe(false);
    expect(overrideAppliesOn(rec, '2026-10-26')).toBe(false);
    expect(overrideAppliesOn(rec, '2026-11-03')).toBe(false);
  });

  it('overrideDatesIntersect', () => {
    const d = { date: '2026-11-02' };
    expect(overrideDatesIntersect(d, { recurrence: { weekdays: ['mon'], from: '2026-11-01' } })).toBe(true);
    expect(overrideDatesIntersect({ recurrence: { weekdays: ['mon'], from: '2026-11-01' } }, d)).toBe(true);
    expect(overrideDatesIntersect(d, { recurrence: { weekdays: ['tue'], from: '2026-11-01' } })).toBe(false);
    expect(overrideDatesIntersect(d, { date: '2026-11-02' })).toBe(true);
    expect(overrideDatesIntersect(d, { date: '2026-11-03' })).toBe(false);
    expect(
      overrideDatesIntersect(
        { recurrence: { weekdays: ['mon'], from: '2026-11-03', until: '2026-11-08' } },
        { recurrence: { weekdays: ['mon'], from: '2026-11-01' } },
      ),
    ).toBe(false);
    expect(
      overrideDatesIntersect(
        { recurrence: { weekdays: ['fri'], from: '2026-11-03' } },
        { recurrence: { weekdays: ['fri', 'sat'], from: '2026-11-01' } },
      ),
    ).toBe(true);
    expect(
      overrideDatesIntersect(
        { recurrence: { weekdays: ['mon'], until: '2026-11-01', from: '2026-10-01' } },
        { recurrence: { weekdays: ['mon'], from: '2026-11-02' } },
      ),
    ).toBe(false);
  });
});

describe('generatedRanges', () => {
  it('cuts minute ranges and drops the leftover', () => {
    expect(generatedRanges({ open: '22:00', close: '01:30' }, 60)).toEqual([
      [1320, 1380],
      [1380, 1440],
      [1440, 1500],
    ]);
    expect(generatedRanges('closed', 60)).toEqual([]);
    expect(generatedRanges({ open: '00:00', close: '00:00' }, 120)).toHaveLength(12);
  });
});

describe('overrideMinutes', () => {
  it('places override times on the business-day timeline', () => {
    const night = { open: '16:00', close: '02:00' };
    expect(overrideMinutes({ start: '01:00', end: '02:00' }, night)).toEqual([1500, 1560]);
    expect(overrideMinutes({ start: '17:00', end: '18:30' }, night)).toEqual([1020, 1110]);
    expect(overrideMinutes({ start: '00:30', end: '01:30' }, 'closed')).toEqual([30, 90]);
    expect(overrideMinutes({ start: '23:30', end: '00:30' }, { open: '08:00', close: '22:00' })).toEqual([1410, 1470]);
    // Only a night session pulls times before its close past midnight; otherwise times are that calendar day.
    expect(overrideMinutes({ start: '08:00', end: '09:00' }, { open: '10:00', close: '12:00' })).toEqual([480, 540]);
    expect(overrideMinutes({ start: '02:00', end: '03:00' }, night)).toEqual([120, 180]);
    expect(overrideMinutes({ start: '05:00', end: '07:00' }, { open: '06:00', close: '06:00' })).toEqual([1740, 1860]);
    expect(overrideMinutes({ start: '01:00', end: '01:00' }, 'closed')).toEqual([60, 1500]);
  });
});

describe('computeSlots past-midnight overrides', () => {
  const iso = (r: ReturnType<typeof computeSlots>) => r.slots.map((s) => [s.startAt.toISOString(), s.source, s.status]);

  it('modify of a past-midnight slot stays on the business night', () => {
    const r = computeSlots(
      input({ overrides: [{ type: 'modify', slotStart: '01:00', start: '01:00', end: '02:00', price: 900 }] }),
    );
    const mods = r.slots.filter((s) => s.source === 'modify');
    expect(mods.map((s) => [s.startAt.toISOString(), s.price])).toEqual([['2026-10-30T19:00:00.000Z', 900]]);
    expect(r.slots).toHaveLength(10);
    expect(r.slots[0]!.startAt.toISOString()).toBe('2026-10-30T10:00:00.000Z');
  });

  it('block after midnight blocks the 00:00 and 01:00 slots', () => {
    const r = computeSlots(input({ overrides: [{ type: 'block', start: '00:30', end: '01:30' }] }));
    expect(r.slots.filter((s) => s.status === 'blocked').map((s) => s.localStart)).toEqual(['00:00', '01:00']);
  });

  it('a block wrapping midnight blocks the 23:00 and 00:00 slots', () => {
    const r = computeSlots(input({ overrides: [{ type: 'block', start: '23:30', end: '00:30' }] }));
    expect(r.slots.filter((s) => s.status === 'blocked').map((s) => s.localStart)).toEqual(['23:00', '00:00']);
  });

  it('an add at or after close of a night session is that calendar morning', () => {
    const r = computeSlots(input({ overrides: [{ type: 'add', start: '02:00', end: '03:00' }] }));
    expect(iso(r)[0]).toEqual(['2026-10-29T20:00:00.000Z', 'add', 'available']);
  });

  it('an add after close of a day session wraps past midnight and is priced by its business-day minute', () => {
    const r = computeSlots(
      input({ hours: { open: '16:00', close: '20:00' }, overrides: [{ type: 'add', start: '23:00', end: '01:00' }] }),
    );
    const add = r.slots.find((s) => s.source === 'add')!;
    expect(add.startAt.toISOString()).toBe('2026-10-30T17:00:00.000Z');
    expect(add.endAt.toISOString()).toBe('2026-10-30T19:00:00.000Z');
    expect(add.price).toBe(1200);
  });

  it('an early add on a day session is that morning, listed in that day', () => {
    const r = computeSlots(
      input({
        businessDate: '2026-10-27',
        hours: { open: '10:00', close: '12:00' },
        overrides: [{ type: 'add', start: '08:00', end: '09:00' }],
      }),
    );
    expect(r.businessDate).toBe('2026-10-27');
    expect(iso(r)[0]).toEqual(['2026-10-27T02:00:00.000Z', 'add', 'available']);
  });

  it('a block before opening blocks the slots it reaches', () => {
    const r = computeSlots(
      input({ hours: { open: '10:00', close: '13:00' }, overrides: [{ type: 'block', start: '09:00', end: '11:00' }] }),
    );
    expect(r.slots.filter((s) => s.status === 'blocked').map((s) => s.localStart)).toEqual(['10:00']);
  });

  it('a block 00:00-02:00 on a night session blocks the 00:00 and 01:00 slots', () => {
    const r = computeSlots(input({ overrides: [{ type: 'block', start: '00:00', end: '02:00' }] }));
    expect(r.slots.filter((s) => s.status === 'blocked').map((s) => s.localStart)).toEqual(['00:00', '01:00']);
  });

  it('spring-forward: an add in the skipped hour gives no inverted slot', () => {
    for (const close of ['01:00', '02:00']) {
      const r = computeSlots(
        input({
          timezone: 'Europe/London',
          businessDate: '2026-03-28',
          hours: { open: '16:00', close },
          overrides: [{ type: 'add', start: '01:30', end: '02:00' }],
        }),
      );
      expect(r.slots.length).toBeGreaterThan(0);
      expect(r.slots.every((s) => s.endAt > s.startAt), close).toBe(true);
    }
  });

  it('never returns overlapping slots: the first of two overlapping adds wins', () => {
    const r = computeSlots(
      input({
        hours: { open: '16:00', close: '20:00' },
        overrides: [
          { type: 'add', start: '20:00', end: '21:00' },
          { type: 'add', start: '20:30', end: '21:30' },
        ],
      }),
    );
    expect(r.slots.filter((s) => s.source === 'add').map((s) => [s.localStart, s.localEnd])).toEqual([['20:00', '21:00']]);
  });

  it('modifies are kept before adds', () => {
    const r = computeSlots(
      input({
        hours: { open: '16:00', close: '20:00' },
        overrides: [
          { type: 'add', start: '18:30', end: '19:30' },
          { type: 'modify', slotStart: '18:00', start: '18:00', end: '19:00' },
        ],
      }),
    );
    expect(r.slots.map((s) => [s.localStart, s.source])).toEqual([
      ['16:00', 'hours'],
      ['17:00', 'hours'],
      ['18:00', 'modify'],
      ['19:00', 'hours'],
    ]);
  });

  it('fall-back modify of 01:00-02:00 spans two elapsed hours and replaces both 01:00 slots', () => {
    const r = computeSlots(
      input({
        timezone: 'Europe/London',
        businessDate: '2026-10-24',
        overrides: [{ type: 'modify', slotStart: '01:00', start: '01:00', end: '02:00' }],
      }),
    );
    const mod = r.slots.find((s) => s.source === 'modify')!;
    expect(mod.endAt.getTime() - mod.startAt.getTime()).toBe(2 * 3_600_000);
    expect(r.slots.filter((s) => s.localStart === '01:00').map((s) => s.source)).toEqual(['modify']);
    expect(r.slots).toHaveLength(10);
  });
});
