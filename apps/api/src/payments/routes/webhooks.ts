import { Router } from 'express';
import mongoose, { type ClientSession } from 'mongoose';
import { payoutStripeWebhookCreds } from '../../admin/settings';
import type { Config } from '../../config';
import { isDuplicateKeyError, runInTransaction } from '../../db';
import { AppError } from '../../errors';
import type { AppServices } from '../../services';
import { applyEvent } from '../apply';
import { PlatformPayout } from '../../platform/payout.model';
import { PlatformWebhookEvent } from '../../platform/webhookEvent.model';
import { GatewayError, gatewayFor, type GatewayCredentials, type GatewayEvent, type PaymentGateway } from '../gateway';
import { GATEWAY_MODES, PaymentGatewayAccount, unsealMode } from '../gateway.model';
import { dispatchRefund } from '../refunds';
import { WebhookEvent, type WebhookOutcome } from '../webhookEvent.model';

/** Only a repeat of this event; any other unique violation is a failed effect that Stripe must retry. */
const isDuplicateEvent = (err: unknown) =>
  isDuplicateKeyError(err) && Object.hasOwn((err as { keyPattern?: object }).keyPattern ?? {}, 'eventId');

const endpointNotFound = () => new AppError(404, 'not_found', 'Webhook endpoint not found');

/** Test and live deliveries share a URL; each is signed with its own mode's secret. */
function verifyEvent(gateway: PaymentGateway, creds: GatewayCredentials[], rawBody: Buffer, signature: string | undefined): GatewayEvent {
  let lastError: unknown;
  for (const c of creds) {
    try {
      return gateway.handleWebhook(c, rawBody, signature);
    } catch (err) {
      if (!(err instanceof GatewayError && err.code === 'invalid_signature')) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

const rawBodyOf = (body: unknown) => (Buffer.isBuffer(body) ? body : Buffer.alloc(0));

/**
 * Settles an owner's Stripe payout to the platform. Platform work, so no tenant: reads and writes are
 * cross-tenant, and each change is conditional on the status it moves from, so a repeat cannot apply twice.
 */
async function applyPayoutEvent(event: GatewayEvent, now: Date, session: ClientSession): Promise<WebhookOutcome> {
  if (event.kind !== 'succeeded' && event.kind !== 'closed' && event.kind !== 'attempt_failed') return 'ignored';
  if (!event.paymentId || !mongoose.isValidObjectId(event.paymentId)) return 'unmatched';
  const payout = await PlatformPayout.findOne({ _id: event.paymentId, method: 'stripe' }).setOptions({ crossTenant: true }).session(session);
  // Bound to the intent made for it, in the mode it was made in: metadata alone could come from any intent,
  // and a test-mode one must not settle a live payout. No stored intent: nothing was ever payable.
  if (!payout || !payout.stripePaymentIntentId || payout.stripePaymentIntentId !== event.gatewayRef) return 'unmatched';
  if (payout.stripeMode !== (event.livemode ? 'live' : 'test')) return 'unmatched';
  const at = { _id: payout._id, ownerId: payout.ownerId, stripePaymentIntentId: payout.stripePaymentIntentId };
  if (event.kind === 'succeeded') {
    if (event.amount !== payout.amount || event.currency !== payout.currency) return 'mismatch';
    // The money arrived, so it counts even when the hold expired or a failed attempt rejected it first.
    const done = await PlatformPayout.updateOne(
      { ...at, status: { $in: ['pending', 'rejected'] } },
      { $set: { status: 'confirmed', rejectReason: null, reviewedAt: now } },
      { session },
    );
    return done.modifiedCount === 1 ? 'applied' : 'ignored';
  }
  const done = await PlatformPayout.updateOne(
    { ...at, status: 'pending' },
    { $set: { status: 'rejected', rejectReason: 'stripe_failed', reviewedAt: now } },
    { session },
  );
  return done.modifiedCount === 1 ? 'applied' : 'ignored';
}

/**
 * `/webhooks/stripe/platform` (the admin's own account, for owner payouts) and `/webhooks/:gateway/:ownerId`;
 * both need the raw body, so the router is mounted before `express.json()`.
 */
export function webhooksRouter(config: Config, services: AppServices): Router {
  const router = Router();

  // Before '/:gateway/:ownerId', which would read 'platform' as an owner id.
  router.post('/stripe/platform', async (req, res) => {
    const gateway = gatewayFor(services, 'stripe');
    const creds = gateway ? await payoutStripeWebhookCreds(config) : [];
    if (!gateway || creds.length === 0) throw endpointNotFound();
    const event = verifyEvent(gateway, creds, rawBodyOf(req.body), req.get('stripe-signature'));
    const now = services.now();
    try {
      await runInTransaction(async (session) => {
        const [row] = await PlatformWebhookEvent.create([{ gateway: gateway.key, eventId: event.id, type: event.type, at: now }], { session });
        const outcome = await applyPayoutEvent(event, now, session);
        await PlatformWebhookEvent.updateOne({ _id: row!._id }, { $set: { outcome } }, { session });
      });
    } catch (err) {
      // Already processed: the first delivery's transaction committed the event row.
      if (!isDuplicateEvent(err)) throw err;
    }
    res.json({ received: true });
  });

  router.post('/:gateway/:ownerId', async (req, res) => {
    const { gateway: key, ownerId } = req.params;
    if (!mongoose.isValidObjectId(ownerId)) throw endpointNotFound();
    const gateway = gatewayFor(services, key);
    const row = gateway && config.paymentsKey ? await PaymentGatewayAccount.findOne({ ownerId, gateway: key }) : null;
    const modes = row && gateway ? GATEWAY_MODES.map((m) => unsealMode(row, m, config, gateway)).filter((m) => m !== null) : [];
    if (!gateway || modes.length === 0) throw endpointNotFound();

    const event = verifyEvent(
      gateway,
      modes.map((m) => m.creds),
      rawBodyOf(req.body),
      req.get('stripe-signature'),
    );

    const now = services.now();
    let refundIds: string[] = [];
    try {
      refundIds = await runInTransaction(async (session) => {
        const [row] = await WebhookEvent.create(
          [{ ownerId, gateway: gateway.key, eventId: event.id, type: event.type, at: now }],
          { session },
        );
        const { outcome, refundIds } = await applyEvent(ownerId, event, { now }, session);
        await WebhookEvent.updateOne({ ownerId, _id: row!._id }, { $set: { outcome } }, { session });
        return refundIds;
      });
    } catch (err) {
      // Already processed: the first delivery's transaction committed the event row.
      if (!isDuplicateEvent(err)) throw err;
    }
    // Committed: send the refunds now. A gateway outage leaves them pending for reconcile, never for Stripe's retry.
    for (const id of refundIds) {
      try {
        await dispatchRefund(id, ownerId, { config, services });
      } catch (err) {
        console.error(`[refunds] dispatch of ${id} failed`, err);
      }
    }
    res.json({ received: true });
  });

  return router;
}
