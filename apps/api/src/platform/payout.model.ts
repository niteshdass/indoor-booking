import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { PAYOUT_METHODS, PAYOUT_STATUSES, type PlatformPayoutJson } from '@booking/shared';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId } = mongoose.Schema.Types;

/**
 * Money an owner sent the platform against the fees its bookings owe. Manual (bKash, Nagad) payouts wait
 * as `pending` until an admin confirms or rejects them; Stripe payouts are settled by the admin account's
 * webhook only. Only confirmed ones count as paid.
 */
const payoutSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    currency: { type: String, required: true },
    /** Minor units of `currency`. */
    amount: { type: Number, required: true, min: 1 },
    method: { type: String, enum: PAYOUT_METHODS, required: true },
    /** Manual payouts: the transfer's TrxID, normalized. Moved to rejectedTrxId on reject, so it can be sent again. */
    trxId: { type: String, default: null },
    rejectedTrxId: { type: String, default: null },
    senderNumber: { type: String, default: null },
    /** Stripe payouts: the PaymentIntent on the admin's account, set once Stripe has created it. */
    stripePaymentIntentId: { type: String, default: null },
    status: { type: String, enum: PAYOUT_STATUSES, required: true },
    /** The owner member who submitted it. */
    by: { type: ObjectId, ref: 'User', default: null },
    rejectReason: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
payoutSchema.index({ ownerId: 1, currency: 1, status: 1 });
payoutSchema.index({ status: 1, createdAt: 1 });
/** A TrxID is used once per method by a pending or confirmed payout (a rejected one's has moved to rejectedTrxId). */
payoutSchema.index({ method: 1, trxId: 1 }, { unique: true, partialFilterExpression: { trxId: { $type: 'string' } } });
payoutSchema.plugin(tenantScoped);

export type PlatformPayoutDoc = HydratedDocument<InferSchemaType<typeof payoutSchema>>;
export const PlatformPayout = mongoose.model('PlatformPayout', payoutSchema);

type PayoutLean = Pick<
  PlatformPayoutDoc,
  '_id' | 'ownerId' | 'currency' | 'amount' | 'method' | 'trxId' | 'rejectedTrxId' | 'senderNumber' | 'status' | 'rejectReason' | 'createdAt' | 'reviewedAt'
>;

export const payoutJson = (p: PayoutLean, ownerName?: string): PlatformPayoutJson => ({
  id: String(p._id),
  ownerId: String(p.ownerId),
  ...(ownerName === undefined ? {} : { ownerName }),
  currency: p.currency,
  amount: p.amount,
  method: p.method as PlatformPayoutJson['method'],
  trxId: p.trxId ?? p.rejectedTrxId ?? null,
  senderNumber: p.senderNumber ?? null,
  status: p.status as PlatformPayoutJson['status'],
  rejectReason: p.rejectReason ?? null,
  createdAt: p.createdAt.toISOString(),
  reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
});
