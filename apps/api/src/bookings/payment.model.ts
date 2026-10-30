import mongoose from 'mongoose';
import { WALLET_PROVIDERS } from '@booking/shared';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId } = mongoose.Schema.Types;

const paymentSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    venueId: { type: ObjectId, ref: 'Venue', required: true },
    bookingId: { type: ObjectId, ref: 'Booking', required: true },
    gateway: { type: String, default: null },
    gatewayAccountId: { type: String, default: null },
    /** The gateway mode (test or live) whose keys took the payment; null for cash and rows from before modes. */
    gatewayMode: { type: String, enum: ['test', 'live', null], default: null },
    method: { type: String, enum: ['card', 'cash', 'wallet'], required: true },
    /** Minor units of `currency`. */
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    status: { type: String, enum: ['succeeded', 'pending', 'failed'], required: true },
    gatewayRef: { type: String, default: null },
    /**
     * How the payment is collected: a card's in-app intent or Checkout link, or a wallet transfer the
     * customer made outside the app and staff check by hand (`manual`); null for cash.
     */
    kind: { type: String, enum: ['intent', 'link', 'manual', null], default: null },
    /** Checkout Session id for link payments. */
    linkRef: { type: String, default: null },
    failureCode: { type: String, default: null },
    /** Sum of this payment's non-failed refunds, pending included (a reservation). */
    refundedAmount: { type: Number, default: 0, min: 0 },
    recordedBy: { type: ObjectId, ref: 'User', default: null },
    /** Succeeded but not counted in the booking's amountPaid (a late or duplicate payment refunded in full); never offered to a cancellation. */
    excess: { type: Boolean, default: false },
    /**
     * The booking group of a multi-day checkout. Its pending card payments share one gateway intent,
     * whose metadata names the first of them; they succeed or fail together.
     */
    groupId: { type: ObjectId, default: null },
    /** The wallet a manual payment was sent with. */
    provider: { type: String, enum: [...WALLET_PROVIDERS, null], default: null },
    /** The wallet's transaction id, normalized; on a group's lead row only, the others share its groupId. */
    trxId: { type: String, default: null },
    /** The number the customer sent from (E.164). Staff only: never in a URL, a log or a player response. */
    senderNumber: { type: String, default: null },
    /** The member who checked a manual payment, and when. */
    verifiedBy: { type: ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
paymentSchema.index({ ownerId: 1, bookingId: 1 });
paymentSchema.index({ ownerId: 1, groupId: 1, status: 1 }, { partialFilterExpression: { groupId: { $type: 'objectId' } } });
// At most one in-flight card payment per booking.
paymentSchema.index(
  { bookingId: 1 },
  { unique: true, partialFilterExpression: { method: 'card', status: 'pending' } },
);
// A TrxID counts once per owner and wallet while its payment is pending or succeeded; a failed one
// ("not received") can be entered again. The plan read partial filters as unable to take $in and
// called for one index per status, but two indexes would let a pending row repeat a succeeded one's
// TrxID; MongoDB 6.0+ accepts $in here, so this is one index.
paymentSchema.index(
  { ownerId: 1, provider: 1, trxId: 1 },
  { unique: true, partialFilterExpression: { trxId: { $type: 'string' }, status: { $in: ['pending', 'succeeded'] } } },
);
paymentSchema.plugin(tenantScoped);

export const Payment = mongoose.model('Payment', paymentSchema);
export type PaymentDoc = InstanceType<typeof Payment>;
