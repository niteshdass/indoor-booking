import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId } = mongoose.Schema.Types;

export const REFUND_REASONS = ['late_payment', 'duplicate_payment', 'amount_mismatch', 'cancellation'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const REFUND_METHODS = ['card', 'cash'] as const;

/** The cancellation rule tier that set the amount; minHoursBefore is null for a staff cancel. */
export type RuleApplied = { minHoursBefore: number | null; percent: number };

/** Money sent back to the player: through the gateway and account that took the payment (card), or handed over in person (cash). */
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
    method: { type: String, enum: REFUND_METHODS, required: true },
    /** Required for card refunds; null for cash. */
    gateway: { type: String, required: function (this: { method?: string }) { return this.method === 'card'; }, default: null },
    /** Required for card refunds; null for cash. */
    gatewayAccountId: { type: String, required: function (this: { method?: string }) { return this.method === 'card'; }, default: null },
    /** The gateway's id for this refund; null until the gateway has answered. */
    gatewayRef: { type: String, default: null },
    status: { type: String, enum: ['pending', 'succeeded', 'failed'], required: true },
    /** Set only for cancellation refunds. */
    ruleApplied: { type: new mongoose.Schema({ minHoursBefore: { type: Number, default: null }, percent: { type: Number, required: true } }, { _id: false, minimize: false }), default: null },
    failureCode: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    dispatchedAt: { type: Date, default: null },
    /** The failed refund this one replaces. */
    retryOf: { type: ObjectId, ref: 'Refund', default: null },
    settledAt: { type: Date, default: null },
    /** The staff member who issued it; null when the system did. */
    by: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
refundSchema.index({ ownerId: 1, bookingId: 1 });
refundSchema.index({ ownerId: 1, gatewayRef: 1 });
refundSchema.index({ status: 1, method: 1, updatedAt: 1 });
refundSchema.plugin(tenantScoped);

export type RefundDoc = HydratedDocument<InferSchemaType<typeof refundSchema>>;
export const Refund = mongoose.model('Refund', refundSchema);
