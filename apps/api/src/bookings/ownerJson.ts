import type { WalletProvider } from '@booking/shared';
import { User } from '../auth/user.model';
import { Turf } from '../venues/turf.model';
import { bookingJson, type BookingDoc } from './booking.model';
import { Payment, type PaymentDoc } from './payment.model';

export type OwnerBooking = ReturnType<typeof bookingJson> & {
  customer: { name: string; phone: string | null; email: string | null } | null;
  turf: { name: string } | null;
  manualPayment: OwnerManualPayment | null;
  dispute: OwnerDispute | null;
};

/** The latest card dispute on the booking's payment. Staff only. */
export type OwnerDispute = {
  ref: string;
  status: 'open' | 'won' | 'lost';
  amount: number;
  currency: string;
  reason: string | null;
  openedAt: string | null;
  closedAt: string | null;
};

/** The latest wallet transfer submitted for the booking or its group. Staff only: it carries the sender number. */
export type OwnerManualPayment = {
  id: string;
  provider: WalletProvider;
  trxId: string;
  /** The whole submission: the lead row plus the rest of its group's rows. */
  amount: number;
  senderNumber: string | null;
  status: 'pending' | 'succeeded' | 'failed';
  submittedAt: string;
};

/**
 * Booking JSON plus the customer, turf name and manual payment, for owner-facing responses. One
 * `$in` query each for the whole list.
 */
export async function ownerBookingsJson(bookings: BookingDoc[]): Promise<OwnerBooking[]> {
  if (bookings.length === 0) return [];
  const playerIds = [...new Set(bookings.filter((b) => b.playerId).map((b) => String(b.playerId)))];
  const turfIds = [...new Set(bookings.map((b) => String(b.turfId)))];
  const groupIds = [...new Set(bookings.filter((b) => b.groupId).map((b) => String(b.groupId)))];
  const [users, turfs, manual] = await Promise.all([
    playerIds.length ? User.find({ _id: { $in: playerIds } }) : [],
    Turf.find({ _id: { $in: turfIds } }).setOptions({ crossTenant: true }),
    // Every manual row: only a lead carries the TrxID, and its group's rows add up to the amount.
    Payment.find({
      ownerId: { $in: [...new Set(bookings.map((b) => String(b.ownerId)))] },
      kind: 'manual',
      $or: [{ bookingId: { $in: bookings.map((b) => b._id) } }, ...(groupIds.length ? [{ groupId: { $in: groupIds } }] : [])],
    })
      .setOptions({ crossTenant: true })
      .sort({ _id: -1 }),
  ]);
  const leads = manual.filter((p) => p.trxId);
  /** A submission's rows were written together: same group, same submitted time. */
  const amountOf = (lead: PaymentDoc) =>
    lead.groupId
      ? manual
          .filter((p) => String(p.groupId) === String(lead.groupId) && p.createdAt.getTime() === lead.createdAt.getTime())
          .reduce((n, p) => n + p.amount, 0)
      : lead.amount;
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const turfById = new Map(turfs.map((t) => [String(t._id), t]));
  return bookings.map((b) => {
    const u = b.playerId ? userById.get(String(b.playerId)) : undefined;
    const t = turfById.get(String(b.turfId));
    const customer = b.playerId
      ? u ? { name: u.name, phone: u.phone ?? null, email: u.email ?? null } : null
      : b.guest ? { name: b.guest.name, phone: b.guest.phone, email: null } : null;
    const m = leads.find((p) => String(p.bookingId) === String(b._id) || (b.groupId && String(p.groupId) === String(b.groupId)));
    return { ...bookingJson(b), customer, turf: t ? { name: t.name } : null, manualPayment: m ? manualPaymentJson(m, amountOf(m)) : null, dispute: disputeJson(b) };
  });
}

export async function ownerBookingJson(b: BookingDoc): Promise<OwnerBooking> {
  return (await ownerBookingsJson([b]))[0]!;
}

const manualPaymentJson = (p: PaymentDoc, amount: number): OwnerManualPayment => ({
  id: String(p._id),
  provider: p.provider as WalletProvider,
  trxId: p.trxId!,
  amount,
  senderNumber: p.senderNumber ?? null,
  status: p.status as OwnerManualPayment['status'],
  submittedAt: p.createdAt.toISOString(),
});

const disputeJson = (b: BookingDoc): OwnerDispute | null =>
  b.dispute
    ? {
        ref: b.dispute.ref,
        status: b.dispute.status as OwnerDispute['status'],
        amount: b.dispute.amount,
        currency: b.dispute.currency,
        reason: b.dispute.reason ?? null,
        openedAt: b.dispute.openedAt ? b.dispute.openedAt.toISOString() : null,
        closedAt: b.dispute.closedAt ? b.dispute.closedAt.toISOString() : null,
      }
    : null;
