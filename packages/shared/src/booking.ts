import { quoteAddons, type AddonLine, type AddonSelection, type OfferedAddon } from './addons';
import { assertMinor, percentOf } from './money';
import { platformFeeFor, type PlatformFeeSettings, type PlatformFeeSnapshot } from './platformFee';
import type { PaymentPolicy } from './settings';
import type { ComputedSlot, DaySlots } from './slots';
import type { BookingStatus } from './statuses';

export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  awaiting_payment: ['pending', 'confirmed', 'expired', 'cancelled'],
  pending: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled'],
  rejected: [],
  cancelled: [],
  expired: [],
  completed: [],
  no_show: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

export const MAX_SLOTS_PER_BOOKING = 12;
/** Most bookings one checkout makes at once; each is one run of slots on one day. */
export const MAX_BOOKINGS_PER_GROUP = 14;
/** How long an awaiting_payment booking holds its slots. */
export const HOLD_MINUTES = 10;
/** Longer hold for manual wallet payments: the customer pays outside the app, then submits a TrxID. */
export const MANUAL_HOLD_MINUTES = 15;

export class BookingQuoteError extends Error {
  constructor(
    public code:
      | 'no_slots'
      | 'too_many_slots'
      | 'duplicate_slot'
      | 'slot_unavailable'
      | 'slots_not_consecutive'
      | 'day_closed',
    public startAt: string | null = null,
  ) {
    super(startAt ? `Booking: ${code} (${startAt})` : `Booking: ${code}`);
    this.name = 'BookingQuoteError';
  }
}

/** Matches the requested starts to the day's slots; the result is sorted and back to back. */
export function pickSlots(
  day: DaySlots,
  startAts: Date[],
  opts: { now: Date; allowInProgress: boolean },
): ComputedSlot[] {
  if (startAts.length === 0) throw new BookingQuoteError('no_slots');
  if (startAts.length > MAX_SLOTS_PER_BOOKING) throw new BookingQuoteError('too_many_slots');
  const times = startAts.map((d) => d.getTime());
  if (new Set(times).size !== times.length) throw new BookingQuoteError('duplicate_slot');
  if (day.closed) throw new BookingQuoteError('day_closed');

  const picked: ComputedSlot[] = [];
  for (const startAt of startAts) {
    const slot = day.slots.find((s) => s.startAt.getTime() === startAt.getTime());
    const ok =
      slot !== undefined &&
      slot.price !== null &&
      (slot.status === 'available' ||
        (slot.status === 'past' && opts.allowInProgress && slot.endAt.getTime() > opts.now.getTime()));
    if (!slot || !ok) throw new BookingQuoteError('slot_unavailable', startAt.toISOString());
    picked.push(slot);
  }
  picked.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  for (let i = 1; i < picked.length; i++) {
    if (picked[i - 1]!.endAt.getTime() !== picked[i]!.startAt.getTime()) {
      throw new BookingQuoteError('slots_not_consecutive');
    }
  }
  return picked;
}

/** Amount due up front; never more than the total. */
export function advanceFor(policy: PaymentPolicy, total: number): number {
  switch (policy.type) {
    case 'none':
      return 0;
    case 'full':
      return total;
    case 'partial_percent':
      return percentOf(total, policy.percent);
    case 'partial_fixed':
      return Math.min(policy.amount, total);
  }
}

export function initialStatus(input: {
  source: 'online' | 'walkin';
  guest: boolean;
  advanceRequired: number;
}): 'awaiting_payment' | 'pending' | 'confirmed' {
  if (input.source === 'walkin') return 'confirmed';
  if (input.guest) return 'pending';
  return input.advanceRequired > 0 ? 'awaiting_payment' : 'confirmed';
}

export function paymentStatusFor(amountPaid: number, total: number): 'unpaid' | 'partially_paid' | 'paid' {
  if (amountPaid >= total) return 'paid';
  return amountPaid > 0 ? 'partially_paid' : 'unpaid';
}

export type BookingQuote = {
  slots: { startAt: Date; endAt: Date; price: number }[];
  addons: AddonLine[];
  subtotal: number;
  addonsTotal: number;
  /** Minor units a coupon takes off the slots and add-ons; 0 without one. */
  discount: number;
  total: number;
  advanceRequired: number;
  platformFee: PlatformFeeSnapshot | null;
};

/** `paymentPolicy: null` is a walk-in: nothing is due up front. */
export function quoteBooking(input: {
  slots: ComputedSlot[];
  offered: OfferedAddon[];
  indoor: boolean;
  selection: AddonSelection[];
  inUse?: Record<string, number>;
  paymentPolicy: PaymentPolicy | null;
  /** Omitted or null: no platform fee (e.g. walk-ins). */
  fee?: { settings: PlatformFeeSettings; currency: string } | null;
  /** Minor units off the slots and add-ons (a coupon); capped at their sum. The fee and advance are on what is left. */
  discount?: number;
}): BookingQuote {
  const slots = input.slots.map((s) => {
    if (s.price === null) throw new BookingQuoteError('slot_unavailable', s.startAt.toISOString());
    return { startAt: s.startAt, endAt: s.endAt, price: s.price };
  });
  const subtotal = slots.reduce((sum, s) => sum + s.price, 0);
  const { lines, total: addonsTotal } = quoteAddons({
    offered: input.offered,
    slots: input.slots,
    indoor: input.indoor,
    selection: input.selection,
    inUse: input.inUse,
  });
  const gross = subtotal + addonsTotal;
  assertMinor(gross);
  const discount = Math.min(input.discount ?? 0, gross);
  assertMinor(discount);
  const base = gross - discount;
  const platformFee = input.fee ? platformFeeFor(input.fee.settings, base, input.fee.currency) : null;
  const playerFee = platformFee?.payer === 'player' ? platformFee.amount : 0;
  const total = base + playerFee;
  assertMinor(total);
  const baseAdvance = input.paymentPolicy ? advanceFor(input.paymentPolicy, base) : 0;
  return {
    slots,
    addons: lines,
    subtotal,
    addonsTotal,
    discount,
    total,
    advanceRequired: baseAdvance > 0 ? Math.min(total, baseAdvance + playerFee) : 0,
    platformFee,
  };
}
