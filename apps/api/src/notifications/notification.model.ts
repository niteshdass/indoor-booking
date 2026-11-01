import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { LOCALES } from '@booking/shared';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';
import { NOTICE_EVENTS } from './templates';

const { ObjectId, Mixed } = mongoose.Schema.Types;

/** One message to one address: written in the transaction that caused it, sent later by deliverNotifications. */
const notificationSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    bookingId: { type: ObjectId, ref: 'Booking', default: null },
    event: { type: String, enum: NOTICE_EVENTS, required: true },
    channel: { type: String, enum: ['email', 'sms'], required: true },
    /** Email address or phone number. */
    to: { type: String, required: true },
    locale: { type: String, enum: LOCALES, required: true },
    /** NoticeData, rendered at delivery time. */
    data: { type: Mixed, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, required: true },
    lastError: { type: String, default: null },
    sentAt: { type: Date, default: null },
    /** SMS parts the sent message took (whether or not they were charged); null for email and unsent rows. */
    smsSegments: { type: Number, default: null },
    /** event:bookingId:refundId:channel:to, so a repeated event never queues the same message twice. */
    dedupeKey: { type: String, required: true, unique: true },
  },
  { timestamps: true, minimize: false },
);
notificationSchema.index({ status: 1, nextAttemptAt: 1 });
// An owner's SMS use per month.
notificationSchema.index({ ownerId: 1, sentAt: 1 }, { partialFilterExpression: { channel: 'sms', status: 'sent' } });
notificationSchema.plugin(tenantScoped);

export type NotificationDoc = HydratedDocument<InferSchemaType<typeof notificationSchema>>;
export const Notification = mongoose.model('Notification', notificationSchema);
