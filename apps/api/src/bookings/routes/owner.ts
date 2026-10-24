import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { BOOKING_STATUSES, localParts, paymentStatusFor, type BookingStatus } from '@booking/shared';
import { normalizePhone } from '../../auth/normalize';
import { nameSchema } from '../../auth/routes/emailAuth';
import { User } from '../../auth/user.model';
import type { Config } from '../../config';
import { runInTransaction } from '../../db';
import { AppError } from '../../errors';
import { isoDateSchema } from '../../schedule/schemas';
import type { AppServices } from '../../services';
import { expireHold, paymentsUnavailable, startLink } from '../../payments/intent';
import { loadGateway } from '../../payments/gateway.model';
import { Refund } from '../../payments/refund.model';
import { refundJson } from '../../payments/refunds';
import { logActivity } from '../../tenancy/activityLog.model';
import { permissionsCover, requirePermission, tenantOf } from '../../tenancy/context';
import { tenantRepo } from '../../tenancy/repo';
import { scopedTurf } from '../../venues/guards';
import { scopedVenue } from '../../venues/routes/venues';
import { Booking, bookingJson } from '../booking.model';
import { cancelBooking, previewCancellation } from '../cancel';
import { createBooking } from '../create';
import { Payment, type PaymentDoc } from '../payment.model';
import { invalidTransition, scopedBooking, transition } from '../transition';
import { addonsSchema, startAtsSchema } from './public';

const MAX_RANGE_DAYS = 31;
const LIST_LIMIT = 500;
const CHECK_IN_LEAD_MS = 60 * 60_000;
/** Statuses that still take a cash payment. */
const CASH_STATUSES: readonly BookingStatus[] = ['pending', 'confirmed', 'completed', 'no_show'];

const idQuery = z.string().regex(/^[0-9a-f]{24}$/i, 'Must be an id');

const listQuery = z.object({
  venueId: idQuery.optional(),
  turfId: idQuery.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
});

const walkinSchema = z
  .object({
    date: isoDateSchema,
    startAts: startAtsSchema,
    addons: addonsSchema,
    customer: z
      .object({ name: nameSchema, phone: z.string().max(32), playerId: z.string().max(64).optional() })
      .strict(),
    payment: z.discriminatedUnion('method', [
      z.object({ method: z.literal('cash'), amount: z.number().int().optional() }).strict(),
      z.object({ method: z.literal('link'), amount: z.number().int().optional() }).strict(),
      z.object({ method: z.literal('unpaid') }).strict(),
    ]),
  })
  .strict();

const rejectSchema = z.object({ reason: z.string().trim().max(300).optional() }).strict();
const cancelSchema = z.object({ reason: z.string().trim().max(300).optional() }).strict();
const cashSchema = z.object({ amount: z.number().int().optional() }).strict();

const invalidAmount = (max: number) =>
  new AppError(400, 'invalid_amount', `Amount must be between 1 and ${max}`);

const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

const tooEarly = () => new AppError(409, 'too_early', 'It is too early for this action');

/** Mounted on ownerRouter. */
export function ownerBookingsRouter(config: Config, services: AppServices): Router {
  const router = Router({ mergeParams: true });

  router.get('/bookings', requirePermission('booking.view'), async (req, res) => {
    const t = tenantOf(req);
    const q = listQuery.parse(req.query);
    let { from, to } = q;
    if (q.venueId) {
      const venue = await scopedVenue(t, q.venueId);
      const today = localParts(services.now(), venue.timezone).date;
      from ??= today;
      to ??= today;
    } else if (!from || !to) {
      throw new AppError(400, 'validation_error', 'from and to are required without a venueId');
    }
    if (to < from) throw new AppError(400, 'validation_error', 'to must not be before from');
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
      throw new AppError(400, 'validation_error', `Range is at most ${MAX_RANGE_DAYS} days`);
    }
    const filter: Record<string, unknown> = { businessDate: { $gte: from, $lte: to } };
    if (q.venueId) filter.venueId = q.venueId;
    if (q.turfId) filter.turfId = q.turfId;
    if (q.status) filter.status = q.status;
    const bookings = await tenantRepo(Booking, t, { venueField: 'venueId' })
      .find(filter)
      .sort({ startAt: 1 })
      .limit(LIST_LIMIT);
    res.json({ bookings: bookings.map(bookingJson) });
  });

  router.get('/bookings/:bookingId', requirePermission('booking.view'), async (req, res) => {
    const t = tenantOf(req);
    const booking = await scopedBooking(t, req.params.bookingId as string);
    const payments = await Payment.find({ ownerId: t.ownerId, bookingId: booking._id }).sort({ _id: 1 });
    const refunds = await Refund.find({ ownerId: t.ownerId, bookingId: booking._id }).sort({ _id: 1 });
    res.json({ booking: bookingJson(booking), payments: payments.map(paymentJson), refunds: refunds.map(refundJson) });
  });

  router.get('/bookings/:bookingId/cancellation', requirePermission('booking.view'), async (req, res) => {
    const booking = await scopedBooking(tenantOf(req), req.params.bookingId as string);
    res.json({ preview: await previewCancellation(booking, 'staff', services.now()) });
  });

  router.post('/bookings/:bookingId/cancel', requirePermission('booking.cancel'), async (req, res) => {
    const t = tenantOf(req);
    const { reason } = cancelSchema.parse(req.body ?? {});
    const booking = await scopedBooking(t, req.params.bookingId as string);
    const out = await cancelBooking(booking, { kind: 'staff', t }, { reason: reason || undefined }, { config, services });
    res.json({ booking: bookingJson(out.booking), refunds: out.refunds.map(refundJson) });
  });

  router.post('/venues/:venueId/turfs/:turfId/bookings', requirePermission('booking.create'), async (req, res) => {
    const t = tenantOf(req);
    const input = walkinSchema.parse(req.body);
    const { venue, turf } = await scopedTurf(t, req.params.venueId as string, req.params.turfId as string);
    const phone = normalizePhone(input.customer.phone);
    let playerId: string | null = null;
    if (input.customer.playerId !== undefined) {
      const id = input.customer.playerId;
      const player = mongoose.isValidObjectId(id) ? await User.exists({ _id: id }) : null;
      if (!player) throw new AppError(400, 'player_not_found', 'No such player');
      playerId = id;
    }
    const now = services.now();
    const base = { venue, turf, date: input.date, startAts: input.startAts, selection: input.addons, source: 'walkin' as const, now };

    const cash = input.payment.method === 'cash' ? { amount: input.payment.amount, recordedBy: t.userId } : undefined;
    if (cash && !permissionsCover(t, ['payment.mark_cash'])) {
      throw new AppError(403, 'forbidden', 'You do not have permission to do this');
    }
    // A card link needs booking.create only: staff hand over a link and take no money.
    let card: { amount?: number; gateway: string; gatewayAccountId: string } | undefined;
    if (input.payment.method === 'link') {
      const loaded = await loadGateway(t.ownerId, 'stripe', config, services);
      if (!loaded || !loaded.row.enabled || !loaded.gateway.supports(venue.country, venue.currency)) {
        throw paymentsUnavailable();
      }
      card = { amount: input.payment.amount, gateway: loaded.gateway.key, gatewayAccountId: loaded.row.accountId };
    }
    let linkPayment: PaymentDoc | null = null;
    const booking = await createBooking({
      ...base,
      who: { playerId, guest: { name: input.customer.name, phone }, createdBy: t.userId },
      cash,
      card,
      // Same transaction as the inserts: the booking and its log commit or fail together.
      afterInsert: async (session, created, payment) => {
        const venueId = String(created.venueId);
        await logActivity(
          t,
          {
            action: 'booking.create',
            entity: 'booking',
            entityId: created.id as string,
            venueId,
            after: { reference: created.reference, status: created.status, total: created.total },
          },
          now,
          session,
        );
        if (payment?.method === 'card') linkPayment = payment;
        if (payment?.method === 'cash') {
          await logActivity(
            t,
            {
              action: 'payment.cash',
              entity: 'payment',
              entityId: payment.id as string,
              venueId,
              after: { bookingId: created.id, amount: payment.amount },
            },
            now,
            session,
          );
        }
      },
    });
    if (!linkPayment) {
      res.status(201).json({ booking: bookingJson(booking) });
      return;
    }
    // After commit: a Stripe failure leaves the hold in place for the re-issue route.
    const { url } = await startLink(booking, linkPayment, { config, services });
    res.status(201).json({ booking: bookingJson(booking), payment: linkJson(linkPayment, url) });
  });

  router.post('/bookings/:bookingId/payments/link', requirePermission('booking.create'), async (req, res) => {
    const t = tenantOf(req);
    const booking = await scopedBooking(t, req.params.bookingId as string);
    const payment = await Payment.findOne({
      ownerId: t.ownerId,
      bookingId: booking._id,
      method: 'card',
      kind: 'link',
      status: 'pending',
    });
    if (!payment || booking.status !== 'awaiting_payment') {
      throw new AppError(409, 'invalid_transition', 'This booking has no payment link to show');
    }
    const now = services.now();
    if (!booking.holdExpiresAt || booking.holdExpiresAt <= now) {
      await expireHold(booking, now);
      throw new AppError(409, 'hold_expired', 'This hold has expired');
    }
    const { url } = await startLink(booking, payment, { config, services });
    res.json({ payment: linkJson(payment, url) });
  });

  router.post('/bookings/:bookingId/confirm', requirePermission('booking.confirm'), async (req, res) => {
    const t = tenantOf(req);
    const booking = await scopedBooking(t, req.params.bookingId as string);
    // Staff confirm only pending guest bookings; an awaiting_payment hold confirms by payment.
    if (booking.status !== 'pending') throw invalidTransition(booking.status);
    const updated = await runInTransaction((session) =>
      transition(t, booking, 'confirmed', services.now(), session),
    );
    res.json({ booking: bookingJson(updated) });
  });

  router.post('/bookings/:bookingId/reject', requirePermission('booking.confirm'), async (req, res) => {
    const t = tenantOf(req);
    const { reason } = rejectSchema.parse(req.body ?? {});
    const booking = await scopedBooking(t, req.params.bookingId as string);
    const updated = await runInTransaction((session) =>
      transition(t, booking, 'rejected', services.now(), session, { rejectReason: reason || null }),
    );
    res.json({ booking: bookingJson(updated) });
  });

  router.post('/bookings/:bookingId/check-in', requirePermission('booking.checkin'), async (req, res) => {
    const t = tenantOf(req);
    const booking = await scopedBooking(t, req.params.bookingId as string);
    if (booking.status !== 'confirmed') throw invalidTransition(booking.status);
    if (services.now().getTime() < booking.startAt.getTime() - CHECK_IN_LEAD_MS) throw tooEarly();
    const updated = await runInTransaction((session) =>
      transition(t, booking, 'completed', services.now(), session),
    );
    res.json({ booking: bookingJson(updated) });
  });

  router.post('/bookings/:bookingId/no-show', requirePermission('booking.checkin'), async (req, res) => {
    const t = tenantOf(req);
    const booking = await scopedBooking(t, req.params.bookingId as string);
    if (booking.status !== 'confirmed') throw invalidTransition(booking.status);
    if (services.now().getTime() < booking.startAt.getTime()) throw tooEarly();
    const updated = await runInTransaction((session) =>
      transition(t, booking, 'no_show', services.now(), session),
    );
    res.json({ booking: bookingJson(updated) });
  });

  router.post('/bookings/:bookingId/payments/cash', requirePermission('payment.mark_cash'), async (req, res) => {
    const t = tenantOf(req);
    const input = cashSchema.parse(req.body ?? {});
    const booking = await scopedBooking(t, req.params.bookingId as string);
    const status = booking.status as BookingStatus;
    if (!CASH_STATUSES.includes(status)) throw new AppError(409, 'invalid_transition', `This booking is ${status}`);
    const remaining = booking.total - booking.amountPaid;
    if (remaining <= 0) throw new AppError(409, 'already_paid', 'This booking is already paid');
    const amount = input.amount ?? remaining;
    if (amount < 1 || amount > remaining) throw invalidAmount(remaining);

    const now = services.now();
    const { updated, payment } = await runInTransaction(async (session) => {
      // Guarded by the amountPaid we read: a concurrent payment matches nothing and loses.
      const updated = await Booking.findOneAndUpdate(
        { ownerId: t.ownerId, _id: booking._id, status, amountPaid: booking.amountPaid },
        { $inc: { amountPaid: amount }, $set: { paymentStatus: paymentStatusFor(booking.amountPaid + amount, booking.total) } },
        { session, new: true },
      );
      if (!updated) throw new AppError(409, 'invalid_transition', 'This booking was just changed; reload it');
      const [payment] = await Payment.create(
        [
          {
            ownerId: t.ownerId,
            venueId: booking.venueId,
            bookingId: booking._id,
            method: 'cash',
            gateway: null,
            gatewayAccountId: null,
            gatewayRef: null,
            amount,
            currency: booking.currency,
            status: 'succeeded',
            recordedBy: t.userId,
          },
        ],
        { session },
      );
      await logActivity(
        t,
        {
          action: 'payment.cash',
          entity: 'payment',
          entityId: payment!.id as string,
          venueId: String(booking.venueId),
          before: { amountPaid: booking.amountPaid },
          after: { bookingId: booking.id, amount, amountPaid: updated.amountPaid },
        },
        now,
        session,
      );
      return { updated, payment: payment! };
    });
    res.status(201).json({ booking: bookingJson(updated), payment: paymentJson(payment) });
  });

  return router;
}

function linkJson(p: PaymentDoc, url: string) {
  return { id: String(p.id), amount: p.amount, currency: p.currency, url };
}

function paymentJson(p: InstanceType<typeof Payment>) {
  return {
    id: String(p.id),
    method: p.method,
    gateway: p.gateway ?? null,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    recordedBy: p.recordedBy ? String(p.recordedBy) : null,
    createdAt: p.createdAt.toISOString(),
  };
}
