import { Router } from 'express';
import mongoose from 'mongoose';
import type { Config } from '../../config';
import { isDuplicateKeyError, runInTransaction } from '../../db';
import { AppError } from '../../errors';
import type { AppServices } from '../../services';
import { applyEvent } from '../apply';
import { GatewayError, gatewayFor, type GatewayEvent } from '../gateway';
import { GATEWAY_MODES, PaymentGatewayAccount, unsealMode } from '../gateway.model';
import { dispatchRefund } from '../refunds';
import { WebhookEvent } from '../webhookEvent.model';

/** Only a repeat of this event; any other unique violation is a failed effect that Stripe must retry. */
const isDuplicateEvent = (err: unknown) =>
  isDuplicateKeyError(err) && Object.hasOwn((err as { keyPattern?: object }).keyPattern ?? {}, 'eventId');

const endpointNotFound = () => new AppError(404, 'not_found', 'Webhook endpoint not found');

/** `/webhooks/:gateway/:ownerId`; needs the raw body, so it is mounted before `express.json()`. */
export function webhooksRouter(config: Config, services: AppServices): Router {
  const router = Router();

  router.post('/:gateway/:ownerId', async (req, res) => {
    const { gateway: key, ownerId } = req.params;
    if (!mongoose.isValidObjectId(ownerId)) throw endpointNotFound();
    const gateway = gatewayFor(services, key);
    const row = gateway && config.paymentsKey ? await PaymentGatewayAccount.findOne({ ownerId, gateway: key }) : null;
    const modes = row && gateway ? GATEWAY_MODES.map((m) => unsealMode(row, m, config, gateway)).filter((m) => m !== null) : [];
    if (!gateway || modes.length === 0) throw endpointNotFound();

    // Test and live deliveries share the URL; each is signed with its own mode's secret.
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const signature = req.get('stripe-signature');
    let event: GatewayEvent | null = null;
    let lastError: unknown;
    for (const m of modes) {
      try {
        event = gateway.handleWebhook(m.creds, rawBody, signature);
        break;
      } catch (err) {
        if (!(err instanceof GatewayError && err.code === 'invalid_signature')) throw err;
        lastError = err;
      }
    }
    if (!event) throw lastError;

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
