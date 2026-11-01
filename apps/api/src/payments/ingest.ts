import type { Config } from '../config';
import { isDuplicateKeyError, runInTransaction } from '../db';
import type { AppServices } from '../services';
import { applyEvent } from './apply';
import type { GatewayEvent } from './gateway';
import { dispatchRefund } from './refunds';
import { WebhookEvent } from './webhookEvent.model';

/** Only a repeat of this event; any other unique violation is a failed effect that the gateway must retry. */
export const isDuplicateEvent = (err: unknown) =>
  isDuplicateKeyError(err) && Object.hasOwn((err as { keyPattern?: object }).keyPattern ?? {}, 'eventId');

/**
 * Applies a verified gateway event for `ownerId` once: the event row and its effects commit together,
 * so a repeat (another delivery, the browser coming back, the sweep) is a no-op. Refunds the event
 * called for are sent after the commit; a gateway outage leaves them pending for reconcile.
 */
export async function ingestEvent(
  ownerId: string,
  gateway: string,
  event: GatewayEvent,
  deps: { config: Config; services: AppServices },
): Promise<void> {
  const now = deps.services.now();
  let refundIds: string[] = [];
  try {
    refundIds = await runInTransaction(async (session) => {
      const [row] = await WebhookEvent.create([{ ownerId, gateway, eventId: event.id, type: event.type, at: now }], { session });
      const { outcome, refundIds } = await applyEvent(ownerId, event, { now }, session);
      await WebhookEvent.updateOne({ ownerId, _id: row!._id }, { $set: { outcome } }, { session });
      return refundIds;
    });
  } catch (err) {
    // Already processed: the first delivery's transaction committed the event row.
    if (!isDuplicateEvent(err)) throw err;
  }
  for (const id of refundIds) {
    try {
      await dispatchRefund(id, ownerId, deps);
    } catch (err) {
      console.error(`[refunds] dispatch of ${id} failed`, err);
    }
  }
}
