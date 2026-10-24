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
    recordedBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
paymentSchema.index({ ownerId: 1, bookingId: 1 });
paymentSchema.plugin(tenantScoped);

export const Payment = mongoose.model('Payment', paymentSchema);
