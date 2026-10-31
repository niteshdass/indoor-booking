import mongoose from 'mongoose';
import { WEBHOOK_OUTCOMES } from '../payments/webhookEvent.model';

/**
 * A processed event from the admin's own Stripe account (owner payouts to the platform). Not tenant-scoped:
 * the platform has no owner. The unique index makes each event apply at most once.
 */
const platformWebhookEventSchema = new mongoose.Schema({
  gateway: { type: String, required: true },
  eventId: { type: String, required: true },
  type: { type: String, required: true },
  /** Null only inside the transaction that is applying the event. */
  outcome: { type: String, enum: [...WEBHOOK_OUTCOMES, null], default: null },
  at: { type: Date, required: true },
});
platformWebhookEventSchema.index({ eventId: 1 }, { unique: true });

export const PlatformWebhookEvent = mongoose.model('PlatformWebhookEvent', platformWebhookEventSchema, 'platformWebhookEvents');
