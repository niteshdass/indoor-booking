import mongoose from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId } = mongoose.Schema.Types;

export const WEBHOOK_OUTCOMES = ['applied', 'ignored', 'unmatched', 'mismatch'] as const;
export type WebhookOutcome = (typeof WEBHOOK_OUTCOMES)[number];

/** A processed gateway event; the unique index makes each event apply at most once per owner. */
const webhookEventSchema = new mongoose.Schema({
  ownerId: { type: ObjectId, ref: 'Owner', required: true },
  gateway: { type: String, required: true },
  eventId: { type: String, required: true },
  type: { type: String, required: true },
  /** Null only inside the transaction that is applying the event. */
  outcome: { type: String, enum: [...WEBHOOK_OUTCOMES, null], default: null },
  at: { type: Date, required: true },
});
webhookEventSchema.index({ ownerId: 1, gateway: 1, eventId: 1 }, { unique: true });
webhookEventSchema.plugin(tenantScoped);

export const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema, 'webhookEvents');
