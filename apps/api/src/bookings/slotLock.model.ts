import mongoose from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId } = mongoose.Schema.Types;

/** One row per held slot; the unique index is what stops two bookings taking the same slot. */
const slotLockSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    turfId: { type: ObjectId, ref: 'Turf', required: true },
    startAt: { type: Date, required: true },
    bookingId: { type: ObjectId, ref: 'Booking', required: true },
  },
  { timestamps: true },
);
slotLockSchema.index({ turfId: 1, startAt: 1 }, { unique: true });
slotLockSchema.index({ bookingId: 1 });
slotLockSchema.plugin(tenantScoped);

export const SlotLock = mongoose.model('SlotLock', slotLockSchema);
