import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { BOOKING_STATUSES, localParts, paymentStatusFor, type BookingStatus } from '@booking/shared';
import { normalizePhone } from '../../auth/normalize';
import { nameSchema } from '../../auth/routes/emailAuth';
import type { Config } from '../../config';
import { runInTransaction } from '../../db';
import { AppError } from '../../errors';
import { isoDateSchema } from '../../schedule/schemas';
import type { AppServices } from '../../services';
import { expireHold, paymentsUnavailable, startLink } from '../../payments/intent';
import { loadGateway } from '../../payments/gateway.model';
import { rejectManualPayment, verifyManualPayment } from '../../payments/manual';
import { Refund, type RefundDoc } from '../../payments/refund.model';
import { ownerRefundsJson } from '../../payments/refunds';
import { logActivity } from '../../tenancy/activityLog.model';
import { permissionsCover, requirePermission, tenantOf, type TenantContext } from '../../tenancy/context';
import { tenantRepo } from '../../tenancy/repo';
import { noticeBooking } from '../../notifications/outbox';
import { scopedTurf } from '../../venues/guards';
import { scopedVenue } from '../../venues/routes/venues';
import { Booking, type BookingDoc } from '../booking.model';
import { ownerBookingJson, ownerBookingsJson } from '../ownerJson';
import { assertSeriesAnswered, CANCELLABLE, cancelBooking, previewCancellation } from '../cancel';
import { createBooking, createBookingGroup } from '../create';
import { bookingSearchFilter, searchCustomers } from '../customers';
import { Payment, type PaymentDoc } from '../payment.model';
import { invalidTransition, scopedBooking, transition } from '../transition';
import { addonsSchema, groupItems, moreSchema, startAtsSchema } from './public';
import { rescheduleBooking } from '../reschedule';

const MAX_RANGE_DAYS = 31;
const LIST_LIMIT = 500;
/** `to_verify`: any date and status, with a wallet payment staff have not checked yet. */
const LIST_SCOPES = ['all', 'today', 'upcoming', 'past', 'to_verify'] as const;
/** Field and direction: when the booking was made, the reference, or when it is played. */
const LIST_SORTS = ['created-desc', 'created-asc', 'date-asc', 'date-desc', 'ref-asc', 'ref-desc'] as const;
const MAX_PAGE_SIZE = 100;
const SORT_SPEC: Record<(typeof LIST_SORTS)[number], Record<string, 1 | -1>> = {
  'created-desc': { createdAt: -1, _id: -1 },
  'created-asc': { createdAt: 1, _id: 1 },
  'date-asc': { startAt: 1, _id: 1 },
  'date-desc': { startAt: -1, _id: -1 },
  'ref-asc': { reference: 1, _id: 1 },
  'ref-desc': { reference: -1, _id: -1 },
};
/** Each tab's order when the caller names none: newest made first, today and upcoming soonest first, past latest first. */
const DEFAULT_SORT: Record<(typeof LIST_SCOPES)[number], (typeof LIST_SORTS)[number]> = {
  all: 'created-desc',
  today: 'date-asc',
  upcoming: 'date-asc',
  past: 'date-desc',
  to_verify: 'date-asc',
};
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
  /** With `scope` or `q` the list is paged: { bookings, total }. Without either, it is one date range. */
  scope: z.enum(LIST_SCOPES).optional(),
  /** Reference, customer name or phone. */
  q: z.string().trim().min(1).max(80).optional(),
  sort: z.enum(LIST_SORTS).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});

const walkinSchema = z
  .object({
    date: isoDateSchema,
    startAts: startAtsSchema,
    addons: addonsSchema,
    more: moreSchema,
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

const customerQuery = z.object({ q: z.string().trim().min(2).max(80) });

const rejectSchema = z.object({ reason: z.string().trim().max(300).optional() }).strict();
const cancelSchema = z.object({ reason: z.string().trim().max(300).optional() }).strict();
/** Omitting turfId keeps the booking on its court. */
const rescheduleSchema = z.object({ turfId: idQuery.optional(), date: isoDateSchema, startAts: startAtsSchema }).strict();
const cashSchema = z.object({ amount: z.number().int().optional() }).strict();
const verifySchema = z.object({ amountReceived: z.number().int().min(1).optional() }).strict();

const invalidAmount = (max: number) =>
  new AppError(400, 'invalid_amount', `Amount must be between 1 and ${max}`);

const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

const tooEarly = () => new AppError(409, 'too_early', 'It is too early for this action');

/** Confirm and reject wait while a submitted wallet payment is unchecked: verify or reject that instead. */
async function assertNoPaymentToVerify(booking: BookingDoc) {
  if (await Payment.exists({ ownerId: booking.ownerId, bookingId: booking._id, kind: 'manual', status: 'pending' })) {
    throw new AppError(409, 'payment_to_verify', 'Check the payment for this booking first');
  }
}

/**
 * The registered player a walk-in names, or null. Only a player who has already booked within the
 * member's venues can be named (the same people the customer search offers), so staff cannot attach
 * an arbitrary account and read its phone and email back; anyone else is 400 player_not_found.
 */
export async function walkinPlayerId(t: TenantContext, id: string | undefined): Promise<string | null> {
  if (id === undefined) return null;
  const player = mongoose.isValidObjectId(id)
    ? await tenantRepo(Booking, t, { venueField: 'venueId' }).findOne({ playerId: id }).select('_id')
    : null;
  if (!player) throw new AppError(400, 'player_not_found', 'No such player');
  return id;
}

/** Mounted on ownerRouter. */
export function ownerBookingsRouter(config: Config, services: AppServices): Router {
  const router = Router({ mergeParams: true });

  router.get('/bookings', requirePermission('booking.view'), async (req, res) => {
    const t = tenantOf(req);
    const q = listQuery.parse(req.query);
    if (q.scope || q.q) {
      const scope = q.scope ?? 'all';
      const filter: Record<string, unknown> = {};
      if (q.venueId) filter.venueId = q.venueId;
      if (q.turfId) filter.turfId = q.turfId;
      if (q.status) filter.status = q.status;
      // Today, upcoming and past are venue-local dates, so they need the venue.
      if (scope !== 'all' && scope !== 'to_verify' && !q.venueId) throw new AppError(400, 'validation_error', 'venueId is required for this scope');
      const today = q.venueId ? localParts(services.now(), (await scopedVenue(t, q.venueId)).timezone).date : null;
      const date: Record<string, string> = {};
      if (scope === 'today') Object.assign(date, { $gte: today!, $lte: today! });
      if (scope === 'upcoming') date.$gt = today!;
      if (scope === 'past') date.$lt = today!;
      if (q.from) date.$gte = date.$gte && date.$gte > q.from ? date.$gte : q.from;
      if (q.to) date.$lte = date.$lte && date.$lte < q.to ? date.$lte : q.to;
      if (Object.keys(date).length) filter.businessDate = date;
      if (q.q) Object.assign(filter, await bookingSearchFilter(q.q));
      if (scope === 'to_verify') {
        const waiting = { ownerId: t.ownerId, kind: 'manual', status: 'pending', ...(q.venueId ? { venueId: q.venueId } : {}) };
        filter._id = { $in: await Payment.distinct('bookingId', waiting) };
      }
      const repo = tenantRepo(Booking, t, { venueField: 'venueId' });
      const [total, bookings] = await Promise.all([
        repo.countDocuments(filter),
        repo
          .find(filter)
          .sort(SORT_SPEC[q.sort ?? DEFAULT_SORT[scope]])
          .skip((q.page - 1) * q.pageSize)
          .limit(q.pageSize),
      ]);
      res.json({ bookings: await ownerBookingsJson(bookings), total });
      return;
    }
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
    res.json({ bookings: await ownerBookingsJson(bookings) });
  });

  // Past customers for the walk-in and new series forms; booking.create is who fills those in.
  router.get('/customers', requirePermission('booking.create'), async (req, res) => {
    const { q } = customerQuery.parse(req.query);
    res.json({ customers: await searchCustomers(tenantOf(req), q) });
  });

  router.get('/bookings/:bookingId', requirePermission('booking.view'), async (req, res) => {
    const t = tenantOf(req);
    const booking = await scopedBooking(t, req.params.bookingId as string);
    const payments = await Payment.find({ ownerId: t.ownerId, bookingId: booking._id }).sort({ _id: 1 });
    const refunds = await Refund.find({ ownerId: t.ownerId, bookingId: booking._id }).sort({ _id: 1 });
    // The other bookings made in the same go, as far as the member can see them.
    const group = booking.groupId
      ? await tenantRepo(Booking, t, { venueField: 'venueId' })
          .find({ groupId: booking.groupId, _id: { $ne: booking._id } })
          .sort({ businessDate: 1, startAt: 1 })
      : [];
    res.json({
      booking: await ownerBookingJson(booking),
      payments: payments.map(paymentJson),
      refunds: await ownerRefundsJson(refunds),
      group: await ownerBookingsJson(group),
    });
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
    res.json({ booking: await ownerBookingJson(out.booking), refunds: await ownerRefundsJson(out.refunds) });
  });

  // Any court of the venue, any time before the booking ends; the price and payments stay as they are.
  router.post('/bookings/:bookingId/reschedule', requirePermission('booking.reschedule'), async (req, res) => {
    const t = tenantOf(req);
    const { turfId, date, startAts } = rescheduleSchema.parse(req.body ?? {});
    const booking = await scopedBooking(t, req.params.bookingId as string);
    const { venue, turf } = await scopedTurf(t, String(booking.venueId), turfId ?? String(booking.turfId));
    const moved = await rescheduleBooking(booking, { kind: 'staff', t }, { venue, turf, date, startAts }, { services });
    res.json({ booking: await ownerBookingJson(moved) });
  });

  router.get('/booking-groups/:groupId', requirePermission('booking.view'), async (req, res) => {
    const t = tenantOf(req);
    const bookings = await groupOf(t, req.params.groupId as string);
    const refunds = await Refund.find({ ownerId: t.ownerId, bookingId: { $in: bookings.map((b) => b._id) } }).sort({ _id: 1 });
    res.json({ bookings: await ownerBookingsJson(bookings), refunds: await ownerRefundsJson(refunds) });
  });

  // Takes the rest of every booking's total in one go; bookings already paid or past taking cash are skipped.
  router.post('/booking-groups/:groupId/payments/cash', requirePermission('payment.mark_cash'), async (req, res) => {
    const t = tenantOf(req);
    const bookings = await groupOf(t, req.params.groupId as string);
    const owing = bookings.filter((b) => CASH_STATUSES.includes(b.status as BookingStatus) && b.total > b.amountPaid);
    if (owing.length === 0) throw new AppError(409, 'already_paid', 'These bookings are already paid');
    const now = services.now();
    await runInTransaction(async (session) => {
      for (const b of owing) await recordCash(t, b, b.total - b.amountPaid, now, session);
    });
    res.status(201).json({ bookings: await ownerBookingsJson(await groupOf(t, req.params.groupId as string)) });
  });

  // One cancel per booking, each with its own refund; a failure stops there and the rest stay as they are.
  router.post('/booking-groups/:groupId/cancel', requirePermission('booking.cancel'), async (req, res) => {
    const t = tenantOf(req);
    const { reason } = cancelSchema.parse(req.body ?? {});
    const bookings = await groupOf(t, req.params.groupId as string);
    const open = bookings.filter((b) => CANCELLABLE.includes(b.status as BookingStatus));
    if (open.length === 0) throw new AppError(409, 'invalid_transition', 'Nothing in this group can be cancelled');
    const refunds: RefundDoc[] = [];
    for (const b of open) {
      const out = await cancelBooking(b, { kind: 'staff', t }, { reason: reason || undefined }, { config, services });
      refunds.push(...out.refunds);
    }
    res.json({
      bookings: await ownerBookingsJson(await groupOf(t, req.params.groupId as string)),
      refunds: await ownerRefundsJson(refunds),
    });
  });

  router.post('/venues/:venueId/turfs/:turfId/bookings', requirePermission('booking.create'), async (req, res) => {
    const t = tenantOf(req);
    const input = walkinSchema.parse(req.body);
    const { venue, turf } = await scopedTurf(t, req.params.venueId as string, req.params.turfId as string);
    const phone = normalizePhone(input.customer.phone);
    const playerId = await walkinPlayerId(t, input.customer.playerId);
    const now = services.now();
    const base = { venue, turf, date: input.date, startAts: input.startAts, selection: input.addons, source: 'walkin' as const, now, config };
    const many = input.more.length > 0;
    // A group takes each booking's whole total: one amount cannot be split across its bookings.
    if (many && 'amount' in input.payment && input.payment.amount !== undefined) {
      throw new AppError(400, 'validation_error', 'An amount can be set for a single booking only');
    }

    const cash = input.payment.method === 'cash' ? { amount: input.payment.amount, recordedBy: t.userId } : undefined;
    if (cash && !permissionsCover(t, ['payment.mark_cash'])) {
      throw new AppError(403, 'forbidden', 'You do not have permission to do this');
    }
    // A card link needs booking.create only: staff hand over a link and take no money.
    let card: { amount?: number; gateway: string; gatewayAccountId: string; gatewayMode: 'test' | 'live' } | undefined;
    if (input.payment.method === 'link') {
      const loaded = await loadGateway(t.ownerId, 'stripe', config, services);
      if (!loaded || !loaded.row.enabled || !loaded.gateway.supports(venue.country, venue.currency)) {
        throw paymentsUnavailable();
      }
      card = {
        amount: input.payment.amount,
        gateway: loaded.gateway.key,
        gatewayAccountId: loaded.accountId,
        gatewayMode: loaded.mode,
      };
    }
    const who = { playerId, guest: { name: input.customer.name, phone }, createdBy: t.userId };
    // Same transaction as the inserts: the booking and its log commit or fail together.
    const afterInsert = async (session: mongoose.ClientSession, created: BookingDoc, payment: PaymentDoc | null) => {
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
    };
    const bookings = many
      ? await createBookingGroup({
          venue,
          items: await groupItems(venue, turf, input),
          selection: input.addons,
          source: 'walkin',
          now,
          config,
          who,
          cash: cash && { recordedBy: cash.recordedBy },
          card: card && { gateway: card.gateway, gatewayAccountId: card.gatewayAccountId, gatewayMode: card.gatewayMode },
          afterInsert,
        })
      : [await createBooking({ ...base, who, cash, card, afterInsert })];
    const booking = bookings[0]!;
    const json = many ? { booking: await ownerBookingJson(booking), bookings: await ownerBookingsJson(bookings) } : { booking: await ownerBookingJson(booking) };
    // The group's rows share one link; the first booking's row leads it.
    const linkPayment = card ? await Payment.findOne({ ownerId: t.ownerId, bookingId: booking._id, method: 'card', kind: 'link', status: 'pending' }) : null;
    if (!linkPayment) {
      res.status(201).json(json);
      return;
    }
    // After commit: a Stripe failure leaves the hold in place for the re-issue route.
    const { url, amount } = await startLink(booking, linkPayment, { config, services });
    res.status(201).json({ ...json, payment: linkJson(linkPayment, url, amount) });
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
    const { url, amount } = await startLink(booking, payment, { config, services });
    res.json({ payment: linkJson(payment, url, amount) });
  });

  router.post('/bookings/:bookingId/confirm', requirePermission('booking.confirm'), async (req, res) => {
    const t = tenantOf(req);
    const booking = await scopedBooking(t, req.params.bookingId as string);
    await assertSeriesAnswered(booking);
    // Staff confirm only pending guest bookings; an awaiting_payment hold confirms by payment.
    if (booking.status !== 'pending') throw invalidTransition(booking.status);
    await assertNoPaymentToVerify(booking);
    const updated = await runInTransaction(async (session) => {
      const now = services.now();
      const moved = await transition(t, booking, 'confirmed', now, session);
      await noticeBooking('booking_confirmed', moved, now, session);
      return moved;
    });
    res.json({ booking: await ownerBookingJson(updated) });
  });

  router.post('/bookings/:bookingId/reject', requirePermission('booking.confirm'), async (req, res) => {
    const t = tenantOf(req);
    const { reason } = rejectSchema.parse(req.body ?? {});
    const booking = await scopedBooking(t, req.params.bookingId as string);
    await assertSeriesAnswered(booking);
    await assertNoPaymentToVerify(booking);
    const updated = await runInTransaction(async (session) => {
      const now = services.now();
      const moved = await transition(t, booking, 'rejected', now, session, { rejectReason: reason || null });
      await noticeBooking('booking_rejected', moved, now, session, { reason: reason || null });
      return moved;
    });
    res.json({ booking: await ownerBookingJson(updated) });
  });

  router.post('/bookings/:bookingId/payments/manual/verify', requirePermission('payment.verify'), async (req, res) => {
    const t = tenantOf(req);
    const input = verifySchema.parse(req.body ?? {});
    const booking = await scopedBooking(t, req.params.bookingId as string);
    const moved = await verifyManualPayment(t, booking, input, services.now());
    res.json({ booking: await ownerBookingJson(moved.find((b) => String(b._id) === String(booking._id)) ?? booking) });
  });

  router.post('/bookings/:bookingId/payments/manual/reject', requirePermission('payment.verify'), async (req, res) => {
    const t = tenantOf(req);
    const booking = await scopedBooking(t, req.params.bookingId as string);
    const moved = await rejectManualPayment(t, booking, services.now());
    res.json({ booking: await ownerBookingJson(moved.find((b) => String(b._id) === String(booking._id)) ?? booking) });
  });

  router.post('/bookings/:bookingId/check-in', requirePermission('booking.checkin'), async (req, res) => {
    const t = tenantOf(req);
    const booking = await scopedBooking(t, req.params.bookingId as string);
    if (booking.status !== 'confirmed') throw invalidTransition(booking.status);
    if (services.now().getTime() < booking.startAt.getTime() - CHECK_IN_LEAD_MS) throw tooEarly();
    const updated = await runInTransaction((session) =>
      transition(t, booking, 'completed', services.now(), session),
    );
    res.json({ booking: await ownerBookingJson(updated) });
  });

  router.post('/bookings/:bookingId/no-show', requirePermission('booking.checkin'), async (req, res) => {
    const t = tenantOf(req);
    const booking = await scopedBooking(t, req.params.bookingId as string);
    if (booking.status !== 'confirmed') throw invalidTransition(booking.status);
    if (services.now().getTime() < booking.startAt.getTime()) throw tooEarly();
    const updated = await runInTransaction((session) =>
      transition(t, booking, 'no_show', services.now(), session),
    );
    res.json({ booking: await ownerBookingJson(updated) });
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

    const { updated, payment } = await runInTransaction((session) => recordCash(t, booking, amount, services.now(), session));
    res.status(201).json({ booking: await ownerBookingJson(updated), payment: paymentJson(payment) });
  });

  return router;
}

/** The visible bookings of one group, in time order; 404 when the member sees none of them. */
async function groupOf(t: TenantContext, groupId: string): Promise<BookingDoc[]> {
  const bookings = mongoose.isValidObjectId(groupId)
    ? await tenantRepo(Booking, t, { venueField: 'venueId' }).find({ groupId }).sort({ businessDate: 1, startAt: 1 })
    : [];
  if (bookings.length === 0) throw new AppError(404, 'not_found', 'Booking group not found');
  return bookings;
}

/** Records `amount` of cash against a booking and logs it, inside the caller's transaction. */
async function recordCash(t: TenantContext, booking: BookingDoc, amount: number, now: Date, session: mongoose.ClientSession) {
  const status = booking.status;
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
}

/** `amount` is what the link takes: a walk-in group's link pays for every booking of the group. */
function linkJson(p: PaymentDoc, url: string, amount: number) {
  return { id: String(p.id), amount, currency: p.currency, url };
}

function paymentJson(p: InstanceType<typeof Payment>) {
  return {
    id: String(p.id),
    method: p.method,
    gateway: p.gateway ?? null,
    kind: p.kind ?? null,
    provider: p.provider ?? null,
    trxId: p.trxId ?? null,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    recordedBy: p.recordedBy ? String(p.recordedBy) : null,
    createdAt: p.createdAt.toISOString(),
  };
}
