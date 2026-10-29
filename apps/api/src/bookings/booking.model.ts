import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { BOOKING_STATUSES, PAYMENT_STATUSES, SLOT_HOLDING_STATUSES } from '@booking/shared';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId, Mixed } = mongoose.Schema.Types;

const slotSchema = new mongoose.Schema(
  {
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    /** Minor units. */
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const guestSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
  },
  { _id: false },
);

const bookingSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    venueId: { type: ObjectId, ref: 'Venue', required: true },
    turfId: { type: ObjectId, ref: 'Turf', required: true },
    /** Short human-friendly code, unique across all owners. */
    reference: { type: String, required: true, unique: true },
    /** 'YYYY-MM-DD' in the venue's timezone. */
    businessDate: { type: String, required: true },
    /** First slot's start and last slot's end. */
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    slots: { type: [slotSchema], required: true },
    /** AddonLine[]. */
    addons: { type: [Mixed], default: [] },
    currency: { type: String, required: true },
    /** Minor units of `currency`. */
    subtotal: { type: Number, required: true, min: 0 },
    addonsTotal: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    advanceRequired: { type: Number, required: true, min: 0 },
    amountPaid: { type: Number, default: 0, min: 0 },
    /** Sum of this booking's cancellation refunds, pending included. */
    amountRefunded: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: BOOKING_STATUSES, required: true },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, required: true },
    /** Set while awaiting_payment; the slots are free again once it passes. */
    holdExpiresAt: { type: Date, default: null },
    source: { type: String, enum: ['online', 'walkin'], required: true },
    playerId: { type: ObjectId, ref: 'User', default: null },
    guest: { type: guestSchema, default: null },
    /** Venue rules in force when the booking was made. */
    policySnapshot: {
      type: new mongoose.Schema({ paymentPolicy: { type: Mixed, default: null }, refundRules: { type: [Mixed], default: [] } }, { _id: false, minimize: false }),
      required: true,
    },
    createdBy: { type: ObjectId, ref: 'User', default: null },
    /** The recurring series this booking is a game of, if any. */
    seriesId: { type: ObjectId, ref: 'RecurringSeries', default: null },
    /** Shared by the bookings of one multi-day checkout: the same time on several days, paid together. */
    groupId: { type: ObjectId, default: null },
    /**
     * The client's Idempotency-Key, scoped to whoever booked, on the single or first booking of a
     * checkout: a retried request finds it and gets the same bookings back instead of new ones.
     */
    requestKey: { type: String, default: undefined },
    rejectReason: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, enum: ['player', 'guest', 'staff', null], default: null },
    cancelReason: { type: String, default: null },
    completedAt: { type: Date, default: null },
    // Set once when a review is posted; never cleared.
    reviewedAt: { type: Date, default: null },
    // Set when the review-prompt sweep handles the booking.
    reviewRequestedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);
bookingSchema.index({ ownerId: 1, turfId: 1, startAt: 1 });
bookingSchema.index({ ownerId: 1, venueId: 1, businessDate: 1 });
// The owner Bookings list, newest made first.
bookingSchema.index({ ownerId: 1, venueId: 1, createdAt: -1 });
bookingSchema.index({ ownerId: 1, venueId: 1, startAt: 1, endAt: 1 });
bookingSchema.index({ playerId: 1, startAt: -1 });
bookingSchema.index({ ownerId: 1, seriesId: 1, startAt: 1 });
// Guest lookup, and the cap on a guest phone's pending bookings.
bookingSchema.index({ 'guest.phone': 1, status: 1, endAt: 1 });
bookingSchema.index({ ownerId: 1, groupId: 1 }, { partialFilterExpression: { groupId: { $type: 'objectId' } } });
bookingSchema.index({ requestKey: 1 }, { unique: true, partialFilterExpression: { requestKey: { $type: 'string' } } });
// Cross-tenant lifecycle sweeps (jobs/sweeps.ts), paged on (time, _id).
bookingSchema.index({ status: 1, holdExpiresAt: 1, _id: 1 });
bookingSchema.index({ status: 1, startAt: 1, _id: 1 });
bookingSchema.index({ status: 1, endAt: 1, _id: 1 });
// Review-prompt sweep.
bookingSchema.index({ status: 1, completedAt: 1, _id: 1 });
bookingSchema.plugin(tenantScoped);

export type BookingDoc = HydratedDocument<InferSchemaType<typeof bookingSchema>>;
export const Booking = mongoose.model('Booking', bookingSchema);

/** Bookings that currently occupy their slots: holding statuses, with expired payment holds excluded. */
export function holdingFilter(now: Date) {
  return {
    $or: [
      { status: { $in: SLOT_HOLDING_STATUSES.filter((s) => s !== 'awaiting_payment') } },
      { status: 'awaiting_payment', holdExpiresAt: { $gt: now } },
    ],
  };
}

export function bookingJson(b: BookingDoc) {
  return {
    id: String(b.id),
    reference: b.reference,
    venueId: String(b.venueId),
    turfId: String(b.turfId),
    businessDate: b.businessDate,
    slots: b.slots.map((s) => ({ startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(), price: s.price })),
    addons: b.addons,
    currency: b.currency,
    subtotal: b.subtotal,
    addonsTotal: b.addonsTotal,
    total: b.total,
    advanceRequired: b.advanceRequired,
    amountPaid: b.amountPaid,
    amountRefunded: b.amountRefunded,
    status: b.status,
    paymentStatus: b.paymentStatus,
    holdExpiresAt: b.holdExpiresAt ? b.holdExpiresAt.toISOString() : null,
    source: b.source,
    playerId: b.playerId ? String(b.playerId) : null,
    guest: b.guest ? { name: b.guest.name, phone: b.guest.phone } : null,
    seriesId: b.seriesId ? String(b.seriesId) : null,
    groupId: b.groupId ? String(b.groupId) : null,
    rejectReason: b.rejectReason ?? null,
    cancelledAt: b.cancelledAt ? b.cancelledAt.toISOString() : null,
    cancelledBy: b.cancelledBy ?? null,
    cancelReason: b.cancelReason ?? null,
    completedAt: b.completedAt ? b.completedAt.toISOString() : null,
    createdAt: b.createdAt.toISOString(),
  };
}
