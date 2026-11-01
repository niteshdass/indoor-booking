import type { Config } from '../config';
import { Payment } from '../bookings/payment.model';
import type { AppServices } from '../services';
import { GatewayError, type GatewayEvent } from './gateway';
import { loadGateway, type GatewayMode } from './gateway.model';
import { ingestEvent } from './ingest';

/** A pending hosted payment is asked about once its notice is this late. */
export const LOOKUP_AFTER_MINUTES = 10;
/** Unpaid this long after its last session opened, it is closed: sessions expire well before. */
export const CLOSE_AFTER_MINUTES = 120;
const BATCH = 50;
const cross = { crossTenant: true };

/**
 * Sweeper for hosted gateways (SSLCommerz), whose notices can go missing: asks the gateway about
 * each late pending payment and applies what it says, as its notice would have; closes the ones
 * nobody paid. A multi-day group's rows share a session, so each session is asked about once.
 */
export async function reconcileHostedPayments(
  now: Date,
  deps: { config: Config; services: AppServices },
): Promise<{ settled: number; closed: number }> {
  const late = await Payment.find({
    method: 'card',
    kind: 'intent',
    status: 'pending',
    gateway: 'sslcommerz',
    linkOpenedAt: { $lte: new Date(now.getTime() - LOOKUP_AFTER_MINUTES * 60_000) },
  })
    .setOptions(cross)
    .sort({ linkOpenedAt: 1 })
    .limit(BATCH);
  const seen = new Set<string>();
  let settled = 0;
  let closed = 0;
  for (const p of late) {
    const ownerId = String(p.ownerId);
    const tranId = p.linkRef ?? String(p._id);
    if (seen.has(`${ownerId}:${tranId}`)) continue;
    seen.add(`${ownerId}:${tranId}`);
    const mode = p.gatewayMode as GatewayMode | null;
    try {
      let event: GatewayEvent | null = null;
      if (p.linkRef) {
        const loaded = await loadGateway(ownerId, 'sslcommerz', deps.config, deps.services, { mode });
        // Another account cannot vouch for this one's sessions; the account switch already settled it.
        if (!loaded || loaded.accountId !== p.gatewayAccountId || !loaded.gateway.lookupPayment) continue;
        event = await loaded.gateway.lookupPayment(loaded.creds, { paymentId: tranId, currency: p.currency });
      }
      if (event) {
        await ingestEvent(ownerId, 'sslcommerz', event, deps);
        settled += 1;
      } else if (p.linkOpenedAt! <= new Date(now.getTime() - CLOSE_AFTER_MINUTES * 60_000)) {
        await ingestEvent(
          ownerId,
          'sslcommerz',
          { id: `close_${tranId}_${p.linkOpenedAt!.getTime()}`, type: 'sweep.unpaid', livemode: mode === 'live', kind: 'closed', paymentId: tranId, gatewayRef: null },
          deps,
        );
        closed += 1;
      }
    } catch (err) {
      if (!(err instanceof GatewayError)) console.error(`[payments] reconcile of hosted payment ${String(p._id)} failed`, err);
    }
  }
  return { settled, closed };
}
