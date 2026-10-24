export const BOOKING_STATUSES = [
  'awaiting_payment',
  'pending',
  'confirmed',
  'rejected',
  'cancelled',
  'expired',
  'completed',
  'no_show',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Statuses in which a booking gives its slots back. */
export const SLOT_FREEING_STATUSES: readonly BookingStatus[] = ['rejected', 'cancelled', 'expired'];

/**
 * Statuses in which a booking keeps its slots locked: every status that does not free them.
 * Includes completed and no_show, since a checked-in booking still occupies its time.
 */
export const SLOT_HOLDING_STATUSES: readonly BookingStatus[] = BOOKING_STATUSES.filter(
  (s) => !SLOT_FREEING_STATUSES.includes(s),
);

export const PAYMENT_STATUSES = [
  'unpaid',
  'partially_paid',
  'paid',
  'refunded',
  'partially_refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const SLOT_STATUSES = ['available', 'pending', 'booked', 'blocked', 'past'] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

export const OWNER_STATUSES = ['active', 'pending_approval', 'suspended'] as const;
export type OwnerStatus = (typeof OWNER_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['active', 'disabled'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
