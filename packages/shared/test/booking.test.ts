import { describe, it, expect } from 'vitest';
import {
  advanceFor,
  BOOKING_TRANSITIONS,
  BookingQuoteError,
  canTransition,
  initialStatus,
  paymentStatusFor,
  pickSlots,
  quoteBooking,
  MAX_SLOTS_PER_BOOKING,
} from '../src/booking';
import { AddonQuoteError, type OfferedAddon } from '../src/addons';
import { BOOKING_STATUSES, SLOT_FREEING_STATUSES, SLOT_HOLDING_STATUSES } from '../src/statuses';
import type { ComputedSlot, DaySlots } from '../src/slots';

const iso = (h: number) => new Date(Date.UTC(2026, 11, 16, h));

function slotAt(h: number, over: Partial<ComputedSlot> = {}): ComputedSlot {
  const hh = String(h).padStart(2, '0');
  return {
    startAt: iso(h),
    endAt: iso(h + 1),
    localStart: `${hh}:00`,
    localEnd: `${String(h + 1).padStart(2, '0')}:00`,
    price: 1500,
    status: 'available',
    source: 'hours',
    ...over,
  };
}

function day(slots: Partial<ComputedSlot>[], closed = false): DaySlots {
  return {
    businessDate: '2026-12-16',
    closed,
    closedReason: null,
    slots: slots.map((s, i) => ({ ...slotAt(8 + i), ...s })),
  };
}

const NOW = new Date(Date.UTC(2026, 11, 16, 0));
const opts = { now: NOW, allowInProgress: false };

function codeOf(fn: () => unknown): BookingQuoteError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BookingQuoteError);
    return e as BookingQuoteError;
  }
  throw new Error('did not throw');
}

describe('transitions', () => {
  it('allows and forbids', () => {
    expect(canTransition('pending', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'pending')).toBe(false);
    expect(canTransition('completed', 'cancelled')).toBe(false);
    expect(canTransition('rejected', 'confirmed')).toBe(false);
  });
  it('terminal statuses have no exits', () => {
    for (const s of ['rejected', 'cancelled', 'expired', 'completed', 'no_show'] as const) {
      expect(BOOKING_TRANSITIONS[s]).toEqual([]);
    }
  });
});

describe('holding statuses', () => {
  it('is every status minus the freeing ones', () => {
    expect([...SLOT_HOLDING_STATUSES]).toEqual(BOOKING_STATUSES.filter((s) => !SLOT_FREEING_STATUSES.includes(s)));
    expect(SLOT_HOLDING_STATUSES).toContain('completed');
    expect(SLOT_HOLDING_STATUSES).toContain('no_show');
  });
});

describe('pickSlots', () => {
  it('returns consecutive slots sorted', () => {
    const d = day([{ ...slotAt(18) }, { ...slotAt(19) }]);
    const picked = pickSlots(d, [iso(19), iso(18)], opts);
    expect(picked.map((s) => s.localStart)).toEqual(['18:00', '19:00']);
  });
  it('rejects a gap', () => {
    const d = day([slotAt(18), slotAt(19), slotAt(20)]);
    expect(codeOf(() => pickSlots(d, [iso(18), iso(20)], opts)).code).toBe('slots_not_consecutive');
  });
  it('rejects a pending slot with its startAt', () => {
    const d = day([slotAt(18, { status: 'pending' })]);
    const e = codeOf(() => pickSlots(d, [iso(18)], opts));
    expect(e.code).toBe('slot_unavailable');
    expect(e.startAt).toBe(iso(18).toISOString());
  });
  it('rejects a null price and an unmatched start', () => {
    expect(codeOf(() => pickSlots(day([slotAt(18, { price: null })]), [iso(18)], opts)).code).toBe('slot_unavailable');
    expect(codeOf(() => pickSlots(day([slotAt(18)]), [iso(9)], opts)).code).toBe('slot_unavailable');
  });
  it('rejects too many, none, duplicates and closed days', () => {
    const many = Array.from({ length: MAX_SLOTS_PER_BOOKING + 1 }, (_, i) => iso(i));
    expect(codeOf(() => pickSlots(day([]), many, opts)).code).toBe('too_many_slots');
    expect(codeOf(() => pickSlots(day([]), [], opts)).code).toBe('no_slots');
    expect(codeOf(() => pickSlots(day([slotAt(18)]), [iso(18), new Date(iso(18))], opts)).code).toBe('duplicate_slot');
    expect(codeOf(() => pickSlots(day([slotAt(18)], true), [iso(18)], opts)).code).toBe('day_closed');
  });
  it('handles in-progress past slots', () => {
    const d = day([slotAt(18, { status: 'past' })]);
    const during = new Date(Date.UTC(2026, 11, 16, 18, 30));
    expect(codeOf(() => pickSlots(d, [iso(18)], { now: during, allowInProgress: false })).code).toBe('slot_unavailable');
    expect(pickSlots(d, [iso(18)], { now: during, allowInProgress: true })).toHaveLength(1);
    const after = new Date(Date.UTC(2026, 11, 16, 19));
    expect(codeOf(() => pickSlots(d, [iso(18)], { now: after, allowInProgress: true })).code).toBe('slot_unavailable');
    expect(codeOf(() => pickSlots(d, [iso(18)], { now: after, allowInProgress: false })).code).toBe('slot_unavailable');
  });
});

describe('advanceFor', () => {
  it('applies each policy', () => {
    expect(advanceFor({ type: 'none' }, 1000)).toBe(0);
    expect(advanceFor({ type: 'full' }, 4200)).toBe(4200);
    expect(advanceFor({ type: 'partial_percent', percent: 33.33 }, 1005)).toBe(335);
    expect(advanceFor({ type: 'partial_percent', percent: 12.5 }, 12345)).toBe(1543);
    expect(advanceFor({ type: 'partial_fixed', amount: 5000 }, 3000)).toBe(3000);
    expect(advanceFor({ type: 'partial_fixed', amount: 500 }, 3000)).toBe(500);
  });
});

describe('initialStatus', () => {
  it('follows source, guest and advance', () => {
    expect(initialStatus({ source: 'walkin', guest: false, advanceRequired: 0 })).toBe('confirmed');
    expect(initialStatus({ source: 'online', guest: true, advanceRequired: 0 })).toBe('pending');
    expect(initialStatus({ source: 'online', guest: false, advanceRequired: 0 })).toBe('confirmed');
    expect(initialStatus({ source: 'online', guest: false, advanceRequired: 840 })).toBe('awaiting_payment');
  });
});

describe('paymentStatusFor', () => {
  it('derives from paid vs total', () => {
    expect(paymentStatusFor(0, 1000)).toBe('unpaid');
    expect(paymentStatusFor(400, 1000)).toBe('partially_paid');
    expect(paymentStatusFor(1000, 1000)).toBe('paid');
    expect(paymentStatusFor(0, 0)).toBe('paid');
  });
});

describe('quoteBooking', () => {
  const racket: OfferedAddon = {
    addonId: 'racket', name: 'Racket', pricingType: 'per_unit', unitPrice: 150,
    maxQuantity: 4, stock: null, autoApply: null,
  };
  const slots = [slotAt(18, { price: 1500 }), slotAt(19, { price: 2000 })];
  const base = { slots, offered: [racket], indoor: true, selection: [{ addonId: 'racket', quantity: 2 }] };

  it('totals slots, add-ons and advance', () => {
    const q = quoteBooking({ ...base, paymentPolicy: { type: 'partial_percent', percent: 20 } });
    expect(q).toMatchObject({ subtotal: 3500, addonsTotal: 300, total: 3800, advanceRequired: 760 });
    expect(q.slots).toEqual([
      { startAt: iso(18), endAt: iso(19), price: 1500 },
      { startAt: iso(19), endAt: iso(20), price: 2000 },
    ]);
    expect(q.addons).toHaveLength(1);
  });
  it('walk-in has no advance', () => {
    expect(quoteBooking({ ...base, paymentPolicy: null }).advanceRequired).toBe(0);
  });
  it('propagates add-on errors', () => {
    expect(() =>
      quoteBooking({ ...base, selection: [{ addonId: 'nope' }], paymentPolicy: null }),
    ).toThrow(AddonQuoteError);
  });
});
