import { Router } from 'express';
import { z } from 'zod';
import { bookingPaymentStatus, normalizeTrxId } from '@booking/shared';
import type { Config } from '../../config';
import { Booking } from '../../bookings/booking.model';
import { ownerBookingsJson } from '../../bookings/ownerJson';
import { Payment } from '../../bookings/payment.model';
import { runInTransaction } from '../../db';
import { AppError } from '../../errors';
import type { AppServices } from '../../services';
import { requirePermission, tenantOf } from '../../tenancy/context';
import { tenantRepo } from '../../tenancy/repo';
import { scopedVenue } from '../../venues/routes/venues';
import { gatewayFor } from '../gateway';
import { loadGateway, type GatewayMode } from '../gateway.model';
import { Refund, REFUND_METHODS, type RefundDoc } from '../refund.model';
import { dispatchRefund, ownerRefundsJson, reserveRefunds, settleRefund } from '../refunds';

const markSentSchema = z.object({ trxId: z.string() });

/** Refunds per list page. */
export const REFUNDS_PAGE_SIZE = 50;

const idQuery = z.string().regex(/^[0-9a-f]{24}$/i, 'Must be an id');

/** Without filters the list is the wallet refunds staff still have to send by hand. */
const listQuery = z.object({
  method: z.enum(REFUND_METHODS).default('wallet'),
  status: z.enum(['pending', 'succeeded', 'failed']).default('pending'),
  venueId: idQuery.optional(),
  before: idQuery.optional(),
});
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
   * Refunds across bookings, newest first, each with a short summary of its booking. Paged by
   * `before` (the last id of the previous page); `nextBefore` is null on the last page.
   */
  router.get('/refunds', requirePermission('payment.verify'), async (req, res) => {
    const t = tenantOf(req);
    const q = listQuery.parse(req.query);
    const filter: Record<string, unknown> = { method: q.method, status: q.status };
    if (q.venueId) {
      await scopedVenue(t, q.venueId);
      filter.venueId = q.venueId;
    }
    if (q.before) filter._id = { $lt: q.before };
    const rows = await tenantRepo(Refund, t, { venueField: 'venueId' })
      .find(filter)
      .sort({ _id: -1 })
      .limit(REFUNDS_PAGE_SIZE + 1);
    const page = rows.slice(0, REFUNDS_PAGE_SIZE);
    const bookings = page.length
      ? await ownerBookingsJson(await Booking.find({ ownerId: t.ownerId, _id: { $in: page.map((r) => r.bookingId) } }))
      : [];
    const bookingById = new Map(bookings.map((b) => [b.id, b]));
    const json = await ownerRefundsJson(page);
    res.json({
      refunds: page.map((r, i) => {
        const b = bookingById.get(String(r.bookingId));
        return {
          ...json[i]!,
          booking: b
            ? {
                id: b.id,
                reference: b.reference,
                businessDate: b.businessDate,
                venueId: b.venueId,
                turf: b.turf,
                customer: b.customer ? { name: b.customer.name, phone: b.customer.phone } : null,
              }
            : null,
        };
      }),
      nextBefore: rows.length > REFUNDS_PAGE_SIZE ? String(page[page.length - 1]!._id) : null,
    });
  });

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
    res.status(201).json({ refund: (await ownerRefundsJson([(await Refund.findOne({ ownerId: t.ownerId, _id: row._id }))!]))[0] });
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
      res.json({ refund: (await ownerRefundsJson([(await Refund.findOne({ ownerId: t.ownerId, _id: old._id }))!]))[0] });
      return;
    }
    if (old.method !== 'card' || old.status !== 'failed') throw invalid();

    const row = await runInTransaction(async (session) => {
      const created = await replaceFailed(old, 'cash', session, t, now);
      await settleRefund(t.ownerId, created._id, { status: 'succeeded' }, now, session, actor);
      return created;
    });
    res.status(201).json({ refund: (await ownerRefundsJson([(await Refund.findOne({ ownerId: t.ownerId, _id: row._id }))!]))[0] });
  });

  // Staff sent the money back by hand from their own wallet app; the transaction ID is their record of it.
  router.post('/refunds/:refundId/mark-sent', requirePermission('payment.verify'), async (req, res) => {
    const t = tenantOf(req);
    const refund = await scopedRefund(req);
    if (refund.method !== 'wallet' || refund.status !== 'pending') throw invalid();
    const parsed = markSentSchema.safeParse(req.body ?? {});
    const trxId = parsed.success ? normalizeTrxId(parsed.data.trxId) : null;
    if (!trxId) throw new AppError(400, 'invalid_trx_id', 'Enter the Transaction ID of the transfer you sent');
    const now = services.now();
    const done = await runInTransaction(async (session) => {
      const ok = await settleRefund(t.ownerId, refund._id, { status: 'succeeded' }, now, session, { ownerId: t.ownerId, userId: t.userId });
      if (ok) await Refund.updateOne({ ownerId: t.ownerId, _id: refund._id }, { $set: { trxId, by: t.userId } }, { session, timestamps: false });
      return ok;
    });
    if (!done) throw invalid();
    res.json({ refund: (await ownerRefundsJson([(await Refund.findOne({ ownerId: t.ownerId, _id: refund._id }))!]))[0] });
  });

  return router;
}
