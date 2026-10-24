import mongoose from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId } = mongoose.Schema.Types;

const paymentSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    venueId: { type: ObjectId, ref: 'Venue', required: true },
    bookingId: { type: ObjectId, ref: 'Booking', required: true },
    gateway: { type: String, default: null },
    gatewayAccountId: { type: String, default: null },
    method: { type: String, enum: ['card', 'cash', 'wallet'], required: true },
    /** Minor units of `currency`. */
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    status: { type: String, enum: ['succeeded', 'pending', 'failed'], required: true },
    gatewayRef: { type: String, default: null },
    /** How a card payment is collected: an in-app intent or a Checkout link; null for cash. */
    kind: { type: String, enum: ['intent', 'link', null], default: null },
    /** Checkout Session id for link payments. */
    linkRef: { type: String, default: null },
    failureCode: { type: String, default: null },
    /** Sum of this payment's non-failed refunds, pending included (a reservation). */
    refundedAmount: { type: Number, default: 0, min: 0 },
    recordedBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
paymentSchema.index({ ownerId: 1, bookingId: 1 });
// At most one in-flight card payment per booking.
paymentSchema.index(
  { bookingId: 1 },
  { unique: true, partialFilterExpression: { method: 'card', status: 'pending' } },
);
paymentSchema.plugin(tenantScoped);

export const Payment = mongoose.model('Payment', paymentSchema);
export type PaymentDoc = InstanceType<typeof Payment>;
