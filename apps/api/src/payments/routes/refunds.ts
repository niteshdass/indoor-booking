import { Router } from 'express';
import { bookingPaymentStatus } from '@booking/shared';
import type { Config } from '../../config';
import { Booking } from '../../bookings/booking.model';
import { Payment } from '../../bookings/payment.model';
import { runInTransaction } from '../../db';
import { AppError } from '../../errors';
import type { AppServices } from '../../services';
import { requirePermission, tenantOf } from '../../tenancy/context';
import { tenantRepo } from '../../tenancy/repo';
import { gatewayFor } from '../gateway';
import { loadGateway, type GatewayMode } from '../gateway.model';
import { Refund, type RefundDoc } from '../refund.model';
import { dispatchRefund, refundJson, reserveRefunds, settleRefund } from '../refunds';

const invalid = () => new AppError(409, 'invalid_transition', 'This refund cannot be changed that way');

/** Mounted on ownerRouter. */
export function refundsRouter(config: Config, services: AppServices): Router {
  const router = Router({ mergeParams: true });

  const scopedRefund = async (req: Parameters<typeof tenantOf>[0]) => {
    const refund = await tenantRepo(Refund, tenantOf(req), { venueField: 'venueId' }).findById(req.params.refundId as string);
    if (!refund) throw new AppError(404, 'not_found', 'Refund not found');
    return refund;
  };

  /**
   * Inside the transaction: replaces a failed refund with a new row (`method` card or cash) against
   * the same payment. At most one successor per failed row, so a second writer is refused.
   */
  const replaceFailed = async (
    old: RefundDoc,
    method: 'card' | 'cash',
    session: Parameters<Parameters<typeof runInTransaction>[0]>[0],
    t: ReturnType<typeof tenantOf>,
    now: Date,
  ) => {
    const ownerId = t.ownerId;
    const current = await Refund.findOne({ ownerId, _id: old._id }).session(session);
    const child = await Refund.exists({ ownerId, retryOf: old._id }).session(session);
    if (current?.status !== 'failed' || child) throw invalid();
    // Something else may have used the room the failed refund released.
    const payment = await Payment.findOne({ ownerId, _id: old.paymentId }).session(session);
    if (!payment || payment.amount - payment.refundedAmount < old.amount) throw invalid();
    const booking = await Booking.findOne({ ownerId, _id: old.bookingId }).session(session);
    if (!booking) throw new AppError(404, 'not_found', 'Booking not found');
    const [row] = await reserveRefunds(
      {
        booking,
        parts: [{ paymentId: old.paymentId, method, amount: old.amount }],
        reason: old.reason,
        ruleApplied: old.ruleApplied ? { minHoursBefore: old.ruleApplied.minHoursBefore ?? null, percent: old.ruleApplied.percent } : null,
        by: t.userId,
        now,
        retryOf: old._id,
      },
      session,
    );
    if (old.reason === 'cancellation') {
      const fresh = await Booking.findOne({ ownerId, _id: booking._id }).session(session);
      await Booking.updateOne(
        { ownerId, _id: booking._id },
        { $set: { paymentStatus: bookingPaymentStatus(fresh!.amountPaid, fresh!.amountRefunded, fresh!.total) } },
        { session },
      );
    }
    return row!;
  };

  router.post('/refunds/:refundId/retry', requirePermission('refund.issue'), async (req, res) => {
    const t = tenantOf(req);
    const old = await scopedRefund(req);
    if (old.status !== 'failed' || old.method !== 'card') throw invalid();
    const unconfigured = () => new AppError(503, 'payments_unconfigured', 'Payments are not configured on this server');
    if (!config.paymentsKey || !gatewayFor(services, old.gateway!)) throw unconfigured();
    // The payment was taken at one account; if it has been replaced, the money cannot go back through it.
    let loaded: Awaited<ReturnType<typeof loadGateway>>;
    try {
      loaded = await loadGateway(t.ownerId, old.gateway!, config, services, { mode: old.gatewayMode as GatewayMode | null });
    } catch (err) {
      console.error(`[refunds] retry of ${String(old._id)} could not load the ${old.gateway!} gateway`, err);
      throw unconfigured();
    }
    if (!loaded || loaded.accountId !== old.gatewayAccountId) throw invalid();

    const now = services.now();
    const row = await runInTransaction((session) => replaceFailed(old, 'card', session, t, now));
    try {
      await dispatchRefund(String(row._id), t.ownerId, { config, services });
    } catch (err) {
      console.error(`[refunds] dispatch of ${String(row._id)} failed`, err);
    }
    res.status(201).json({ refund: refundJson((await Refund.findOne({ ownerId: t.ownerId, _id: row._id }))!) });
  });

  router.post('/refunds/:refundId/record-cash', requirePermission('refund.issue'), async (req, res) => {
    const t = tenantOf(req);
    const old = await scopedRefund(req);
    const now = services.now();
    const actor = { ownerId: t.ownerId, userId: t.userId };

    if (old.method === 'cash' && old.status === 'pending') {
      const done = await runInTransaction(async (session) => {
        const ok = await settleRefund(t.ownerId, old._id, { status: 'succeeded' }, now, session, actor);
        if (ok) await Refund.updateOne({ ownerId: t.ownerId, _id: old._id }, { $set: { by: t.userId } }, { session, timestamps: false });
        return ok;
      });
      if (!done) throw invalid();
      res.json({ refund: refundJson((await Refund.findOne({ ownerId: t.ownerId, _id: old._id }))!) });
      return;
    }
    if (old.method !== 'card' || old.status !== 'failed') throw invalid();

    const row = await runInTransaction(async (session) => {
      const created = await replaceFailed(old, 'cash', session, t, now);
      await settleRefund(t.ownerId, created._id, { status: 'succeeded' }, now, session, actor);
      return created;
    });
    res.status(201).json({ refund: refundJson((await Refund.findOne({ ownerId: t.ownerId, _id: row._id }))!) });
  });

  return router;
}
