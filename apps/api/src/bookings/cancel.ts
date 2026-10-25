import { bookingPaymentStatus, cancellationRefund, type BookingStatus, type RefundRule } from '@booking/shared';
import type { Config } from '../config';
import { runInTransaction } from '../db';
import { AppError } from '../errors';
import { loadGateway } from '../payments/gateway.model';
import { Refund, type RefundDoc } from '../payments/refund.model';
import { allocateRefund, dispatchRefund, reserveRefunds } from '../payments/refunds';
import { noticeBooking } from '../notifications/outbox';
import type { AppServices } from '../services';
import type { TenantContext } from '../tenancy/context';
import { RecurringSeries } from '../series/series.model';
import { Booking, type BookingDoc } from './booking.model';
import { Payment, type PaymentDoc } from './payment.model';
import { invalidTransition, transition, type Actor } from './transition';

export type Canceller =
  | { kind: 'player'; ownerId: string; userId: string }
  | { kind: 'guest'; ownerId: string }
  | { kind: 'staff'; t: TenantContext };

export type CancellationPreview = {
  percent: number;
  amount: number;
  rule: RefundRule | null;
  amountPaid: number;
  amountRefunded: number;
  currency: string;
  card: number;
  cash: number;
};

const CANCELLABLE: readonly BookingStatus[] = ['awaiting_payment', 'pending', 'confirmed'];

export const seriesRequestOpen = () =>
  new AppError(409, 'series_request_open', 'This series request is still waiting for an answer');

/**
 * A game of a series request waiting for an answer moves only with its series (accept, decline,
 * withdraw), never on its own. The series never returns to requested, so a check outside the
 * transaction cannot go stale in the unsafe direction.
 */
export async function assertSeriesAnswered(booking: BookingDoc): Promise<void> {
  if (!booking.seriesId) return;
  const open = await RecurringSeries.exists({ ownerId: booking.ownerId, _id: booking.seriesId, status: 'requested' });
  if (open) throw seriesRequestOpen();
}

function assertCancellable(booking: BookingDoc, kind: Canceller['kind'], now: Date) {
  if (!CANCELLABLE.includes(booking.status as BookingStatus)) throw invalidTransition(booking.status);
  if (kind !== 'staff' && now >= booking.startAt) throw new AppError(409, 'too_late', 'This booking has already started');
}

function refundFor(booking: BookingDoc, kind: Canceller['kind'], now: Date) {
  return cancellationRefund({
    rules: booking.policySnapshot.refundRules as RefundRule[],
    startAt: booking.startAt,
    now,
    refundable: booking.amountPaid - booking.amountRefunded,
    byStaff: kind === 'staff',
  });
}

const actorOf = (by: Canceller): Actor =>
  by.kind === 'staff' ? by.t : { ownerId: by.ownerId, userId: by.kind === 'player' ? by.userId : null };

/** What cancelling now would refund, and how it splits between card and cash. Throws what cancelBooking would. */
export async function previewCancellation(booking: BookingDoc, by: Canceller['kind'], now: Date): Promise<CancellationPreview> {
  await assertSeriesAnswered(booking);
  assertCancellable(booking, by, now);
  const { percent, amount, rule } = refundFor(booking, by, now);
  const payments: PaymentDoc[] = await Payment.find({ ownerId: booking.ownerId, bookingId: booking._id });
  const parts = allocateRefund(payments, amount);
  const sum = (method: 'card' | 'cash') => parts.filter((p) => p.method === method).reduce((n, p) => n + p.amount, 0);
  return {
    percent,
    amount,
    rule,
    amountPaid: booking.amountPaid,
    amountRefunded: booking.amountRefunded,
    currency: booking.currency,
    card: sum('card'),
    cash: sum('cash'),
  };
}

/** Closes the hold's open card payment at the gateway, so it cannot succeed after the booking is gone. */
async function closeOpenPayment(booking: BookingDoc, deps: { config: Config; services: AppServices }) {
  if (booking.status !== 'awaiting_payment') return;
  const ownerId = String(booking.ownerId);
  const payment = await Payment.findOne({ ownerId, bookingId: booking._id, method: 'card', status: 'pending' });
  if (!payment) return;
  const inProgress = () => new AppError(409, 'payment_in_progress', 'A payment for this booking is in progress');
  try {
    const loaded = await loadGateway(ownerId, payment.gateway!, deps.config, deps.services);
    if (!loaded) {
      console.error(`[bookings] cancel of ${String(booking._id)} could not close payment ${String(payment._id)}: no gateway`);
      throw inProgress();
    }
    await loaded.gateway.cancelPayment(loaded.creds, {
      kind: payment.kind ?? 'intent',
      gatewayRef: payment.gatewayRef ?? null,
      linkRef: payment.linkRef ?? null,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error(`[bookings] cancel of ${String(booking._id)} could not close payment ${String(payment._id)}`, err);
    throw inProgress();
  }
  await Payment.updateOne(
    { ownerId, _id: payment._id, status: 'pending' },
    { $set: { status: 'failed', failureCode: 'booking_cancelled' } },
  );
}

/**
 * Cancels the booking and reserves its refund (tiered for a player or guest, full for staff) in one
 * transaction, then sends card refunds to the gateway. Staff may cancel after the start.
 */
export async function cancelBooking(
  booking: BookingDoc,
  by: Canceller,
  input: { reason?: string; notify?: boolean },
  deps: { config: Config; services: AppServices },
): Promise<{ booking: BookingDoc; refunds: RefundDoc[] }> {
  const { kind } = by;
  const now = deps.services.now();
  const ownerId = String(booking.ownerId);
  await assertSeriesAnswered(booking);
  assertCancellable(booking, kind, now);
  await closeOpenPayment(booking, deps);

  const refunds = await runInTransaction(async (session) => {
    // Re-read: payments may have landed since the caller loaded the booking, and this body can rerun.
    const current = await Booking.findOne({ ownerId, _id: booking._id }).session(session);
    if (!current) throw new AppError(404, 'not_found', 'Booking not found');
    const { percent, amount, rule } = refundFor(current, kind, now);
    const cancelled = await transition(
      actorOf(by),
      current,
      'cancelled',
      now,
      session,
      {
        cancelledAt: now,
        cancelledBy: kind,
        cancelReason: input.reason ?? null,
        paymentStatus: bookingPaymentStatus(current.amountPaid, current.amountRefunded + amount, current.total),
      },
      { refund: { amount, percent, rule } },
    );
    let reserved: RefundDoc[] = [];
    if (amount > 0) {
      const payments = await Payment.find({ ownerId, bookingId: current._id }).session(session);
      const userId = kind === 'staff' ? by.t.userId : kind === 'player' ? by.userId : null;
      reserved = await reserveRefunds(
        {
          booking: current,
          parts: allocateRefund(payments, amount),
          reason: 'cancellation',
          // Staff refund in full whatever tier matched, so no rule applied.
          ruleApplied: { minHoursBefore: kind === 'staff' ? null : (rule?.minHoursBefore ?? null), percent },
          by: userId,
          now,
        },
        session,
      );
    }
    if (input.notify !== false) {
      if (cancelled.seriesId) {
        // One notice per cancelled game; a bulk series cancel passes notify:false and sends its own summary.
        await noticeBooking('series_games_cancelled', cancelled, now, session, {
          seriesId: String(cancelled.seriesId),
          games: [cancelled.startAt.toISOString()],
          toStaff: kind !== 'staff',
          reason: input.reason ?? null,
        });
      } else {
        await noticeBooking('booking_cancelled', cancelled, now, session, {
          amount: reserved.reduce((sum, r) => sum + r.amount, 0),
        });
      }
    }
    return reserved;
  });

  // Committed: send the card refunds now. A gateway outage leaves them pending for reconcile.
  for (const row of refunds.filter((r) => r.method === 'card')) {
    try {
      await dispatchRefund(String(row._id), ownerId, deps);
    } catch (err) {
      console.error(`[refunds] dispatch of ${String(row._id)} failed`, err);
    }
  }

  const [updated, rows] = await Promise.all([
    Booking.findOne({ ownerId, _id: booking._id }),
    Refund.find({ ownerId, _id: { $in: refunds.map((r) => r._id) } }).sort({ createdAt: 1, method: 1 }),
  ]);
  return { booking: updated!, refunds: rows };
}
