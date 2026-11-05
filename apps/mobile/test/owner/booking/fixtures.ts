import type { OwnerBooking } from '../../../src/owner/types';

const HOUR = 3_600_000;

/** A booking for owner tests; `startIn` is hours from now. */
export const makeBooking = (id: string, name: string, over: Partial<OwnerBooking> = {}, startIn = 48): OwnerBooking => {
  const start = new Date(Math.floor((Date.now() + startIn * HOUR) / HOUR) * HOUR);
  const end = new Date(start.getTime() + HOUR);
  return {
    id,
    reference: `BK-${id}`,
    venueId: 'v1',
    turfId: 't1',
    businessDate: start.toISOString().slice(0, 10),
    slots: [{ startAt: start.toISOString(), endAt: end.toISOString(), price: 150000 }],
    addons: [],
    currency: 'BDT',
    subtotal: 150000,
    addonsTotal: 0,
    total: 150000,
    advanceRequired: 0,
    coupon: null,
    platformFee: null,
    amountPaid: 0,
    amountRefunded: 0,
    status: 'confirmed',
    paymentStatus: 'unpaid',
    holdExpiresAt: null,
    source: 'walkin',
    playerId: null,
    guest: null,
    seriesId: null,
    groupId: null,
    rejectReason: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: new Date(Date.now() - HOUR).toISOString(),
    rescheduleCount: 0,
    rescheduledAt: null,
    customer: { name, phone: '+8801700000000', email: null },
    turf: { name: 'Court A' },
    manualPayment: null,
    ...over,
  } as OwnerBooking;
};
