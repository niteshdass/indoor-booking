import mongoose from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId } = mongoose.Schema.Types;

export const REFUND_REASONS = ['late_payment', 'duplicate_payment'] as const;

/** Money sent back through the gateway and account that took the payment. */
const refundSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    venueId: { type: ObjectId, ref: 'Venue', required: true },
    bookingId: { type: ObjectId, ref: 'Booking', required: true },
    paymentId: { type: ObjectId, ref: 'Payment', required: true },
    /** Minor units of `currency`. */
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true },
    reason: { type: String, enum: REFUND_REASONS, required: true },
    gateway: { type: String, required: true },
    gatewayAccountId: { type: String, required: true },
    /** The gateway's id for this refund; null until the gateway has answered. */
    gatewayRef: { type: String, default: null },
    status: { type: String, enum: ['pending', 'succeeded', 'failed'], required: true },
    /** The staff member who issued it; null when the system did. */
    by: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
refundSchema.index({ ownerId: 1, bookingId: 1 });
refundSchema.plugin(tenantScoped);

export const Refund = mongoose.model('Refund', refundSchema);
