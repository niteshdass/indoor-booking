import { Router, type Request } from 'express';
import mongoose, { type ClientSession } from 'mongoose';
import { payoutStripeWebhookCreds } from '../../admin/settings';
import type { Config } from '../../config';
import { runInTransaction } from '../../db';
import { AppError } from '../../errors';
import type { AppServices } from '../../services';
import { Booking } from '../../bookings/booking.model';
import { PlatformPayout } from '../../platform/payout.model';
import { PlatformWebhookEvent } from '../../platform/webhookEvent.model';
import {
  GatewayError,
  gatewayFor,
  type GatewayCredentials,
  type GatewayEvent,
  type PaymentGateway,
  type WebhookDelivery,
} from '../gateway';
import { GATEWAY_MODES, PaymentGatewayAccount, unsealMode } from '../gateway.model';
import { ingestEvent, isDuplicateEvent } from '../ingest';
import type { WebhookOutcome } from '../webhookEvent.model';

const endpointNotFound = () => new AppError(404, 'not_found', 'Webhook endpoint not found');

/** Test and live deliveries share a URL; each verifies only with its own mode's credentials. */
async function verifyEvent(gateway: PaymentGateway, creds: GatewayCredentials[], delivery: WebhookDelivery): Promise<GatewayEvent> {
  let lastError: unknown;
  for (const c of creds) {
    try {
      return await gateway.handleWebhook(c, delivery);
    } catch (err) {
      if (!(err instanceof GatewayError && err.code === 'invalid_signature')) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

const deliveryOf = (req: Request): WebhookDelivery => ({
  rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
  header: (name) => req.get(name),
});

/** The owner's gateway and the credentials of each mode it has keys for; 404 when there are none. */
async function ownerGateway(key: string, ownerId: string, config: Config, services: AppServices) {
  if (!mongoose.isValidObjectId(ownerId)) throw endpointNotFound();
  const gateway = gatewayFor(services, key);
  const row = gateway && config.paymentsKey ? await PaymentGatewayAccount.findOne({ ownerId, gateway: key }) : null;
  const modes = row && gateway ? GATEWAY_MODES.map((m) => unsealMode(row, m, config, gateway)).filter((m) => m !== null) : [];
  if (!gateway || modes.length === 0) throw endpointNotFound();
  return { gateway, creds: modes.map((m) => m.creds) };
}

const RETURN_RESULTS = ['success', 'fail', 'cancel'] as const;

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
    const event = await verifyEvent(gateway, creds, deliveryOf(req));
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

  /**
   * Where SSLCommerz sends the player's browser back to, as a form post carrying the same fields as
   * its notice. Applied like one (the notice may come later, or never), then the browser goes on to
   * the app. Before '/:gateway/:ownerId'. Trouble here never strands the player: it only logs.
   */
  router.post('/sslcommerz/:ownerId/return', async (req, res) => {
    const { ownerId } = req.params;
    const bookingId = String(req.query.booking ?? '');
    const result = RETURN_RESULTS.find((r) => r === req.query.result) ?? 'fail';
    let paid = false;
    try {
      const { gateway, creds } = await ownerGateway('sslcommerz', ownerId, config, services);
      const event = await verifyEvent(gateway, creds, deliveryOf(req));
      await ingestEvent(ownerId, gateway.key, event, { config, services });
      paid = event.kind === 'succeeded';
    } catch (err) {
      if (!(err instanceof GatewayError && err.code === 'invalid_signature') && !(err instanceof AppError)) {
        console.error(`[payments] SSLCommerz return for owner ${ownerId} could not be applied`, err);
      }
    }
    // Only an id of this owner's booking goes into the redirect.
    const known =
      mongoose.isValidObjectId(bookingId) && mongoose.isValidObjectId(ownerId) && !!(await Booking.exists({ ownerId, _id: bookingId }));
    if (!known) {
      res.redirect(303, `${config.appUrl}/me/bookings`);
      return;
    }
    const base = `${config.appUrl}/me/bookings/${bookingId}`;
    if (paid || result === 'success') res.redirect(303, `${base}?paid=1`);
    else res.redirect(303, `${base}/pay?payment=${result === 'cancel' ? 'cancelled' : 'failed'}`);
  });

  router.post('/:gateway/:ownerId', async (req, res) => {
    const { gateway: key, ownerId } = req.params;
    const { gateway, creds } = await ownerGateway(key, ownerId, config, services);
    const event = await verifyEvent(gateway, creds, deliveryOf(req));
    await ingestEvent(ownerId, gateway.key, event, { config, services });
    res.json({ received: true });
  });

  return router;
}
