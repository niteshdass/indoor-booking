import type { ClientSession, FilterQuery } from 'mongoose';
import { runInTransaction } from '../db';
import { AppError } from '../errors';
import { Booking, type BookingDoc } from '../bookings/booking.model';
import { Payment } from '../bookings/payment.model';
import { transition, type Actor } from '../bookings/transition';
import { noticeBooking } from '../notifications/outbox';
import { ownerSettings } from '../venues/effective';
import { lockTurf } from '../venues/guards';

export const SWEEP_BATCH = 200;
/** Page size of every sweep; tests lower it. */
export const sweepConfig = { batch: SWEEP_BATCH };
export const REMINDER_LEAD_MINUTES = 120;
export const HOLD_WARNING_MINUTES = 10;
/** Stored on the booking for staff; the customer's notice is worded by its template, per locale. */
const AUTO_REJECT_REASON = 'Not confirmed in time';
/** pendingAutoRejectHours is at most 72, so nothing starting later can be due. */
const AUTO_REJECT_MAX_HOURS = 72;

const cross = { crossTenant: true };
const MIN = 60_000;
const HOUR = 60 * MIN;

const system = (b: BookingDoc): Actor => ({ ownerId: String(b.ownerId), userId: null });

/**
 * Runs `step` for each booking in its own transaction and counts those it reports as done. A booking
 * whose status moved on since it was selected (a 409 from transition) is skipped quietly; any other
 * throw is logged and the sweep goes on.
 */
async function eachBooking(
  name: string,
  bookings: BookingDoc[],
  step: (b: BookingDoc, session: ClientSession) => Promise<boolean>,
): Promise<number> {
  let done = 0;
  for (const b of bookings) {
    try {
      if (await runInTransaction((session) => step(b, session))) done += 1;
    } catch (err) {
      if (err instanceof AppError && err.code === 'invalid_transition') continue;
      console.error(`[jobs] ${name} of ${String(b._id)} failed`, err);
    }
  }
  return done;
}

type SortKey = 'holdExpiresAt' | 'startAt' | 'endAt';

/**
 * Walks every booking matching `filter` in pages of `sweepConfig.batch`, keyset-paginated on
 * (`key`, _id), so rows a sweep selects but leaves alone never hold back the ones behind them.
 * `pick` narrows each page to the bookings to act on; `step` runs per booking as in eachBooking.
 */
async function sweep(
  name: string,
  filter: FilterQuery<BookingDoc>,
  key: SortKey,
  step: (b: BookingDoc, session: ClientSession) => Promise<boolean>,
  pick: (page: BookingDoc[]) => Promise<BookingDoc[]> | BookingDoc[] = (page) => page,
): Promise<number> {
  const batch = sweepConfig.batch;
  let done = 0;
  let after: BookingDoc | undefined;
  for (;;) {
    const past = after
      ? { $or: [{ [key]: { $gt: after[key] } }, { [key]: after[key], _id: { $gt: after._id } }] }
      : {};
    const page = await Booking.find({ $and: [filter, past] })
      .setOptions(cross)
      .sort({ [key]: 1, _id: 1 })
      .limit(batch);
    done += await eachBooking(name, await pick(page), step);
    if (page.length < batch) return done;
    after = page[page.length - 1];
  }
}

/** Expires lapsed payment holds and frees their slots. The payment and its intent stay for the late-payment path. */
export async function expireHolds(now: Date): Promise<number> {
  return sweep('expireHolds', { status: 'awaiting_payment', holdExpiresAt: { $lte: now } }, 'holdExpiresAt', async (b, session) => {
    const t = system(b);
    await lockTurf(t, String(b.turfId), now, session);
    const fresh = await Booking.findOne({ ownerId: t.ownerId, _id: b._id }).session(session);
    if (fresh?.status !== 'awaiting_payment' || !fresh.holdExpiresAt || fresh.holdExpiresAt > now) return false;
    await transition(t, fresh, 'expired', now, session);
    return true;
  });
}

/** Rejects pending bookings the venue did not confirm by the owner's pendingAutoRejectHours before start. */
export async function autoRejectPending(now: Date): Promise<number> {
  const hoursOf = new Map<string, number>();
  const due = async (page: BookingDoc[]) => {
    const out: BookingDoc[] = [];
    for (const b of page) {
      const ownerId = String(b.ownerId);
      if (!hoursOf.has(ownerId)) hoursOf.set(ownerId, (await ownerSettings(ownerId)).pendingAutoRejectHours);
      if (b.startAt.getTime() - hoursOf.get(ownerId)! * HOUR <= now.getTime()) out.push(b);
    }
    return out;
  };
  return sweep(
    'autoRejectPending',
    { status: 'pending', startAt: { $lte: new Date(now.getTime() + AUTO_REJECT_MAX_HOURS * HOUR) } },
    'startAt',
    async (b, session) => {
      const moved = await transition(system(b), b, 'rejected', now, session, { rejectReason: AUTO_REJECT_REASON });
      await noticeBooking('booking_rejected', moved, now, session, { autoRejected: true });
      return true;
    },
    due,
  );
}

/** Completes confirmed bookings once they have ended. */
export async function autoCompleteBookings(now: Date): Promise<number> {
  return sweep('autoCompleteBookings', { status: 'confirmed', endAt: { $lte: now } }, 'endAt', async (b, session) => {
    await transition(system(b), b, 'completed', now, session);
    return true;
  });
}

/**
 * Enqueues a reminder for confirmed bookings starting within REMINDER_LEAD_MINUTES, except those
 * made inside that window. The notice's dedupe key makes a repeat run a no-op.
 */
export async function sendReminders(now: Date): Promise<number> {
  const lead = REMINDER_LEAD_MINUTES * MIN;
  return sweep(
    'sendReminders',
    {
      status: 'confirmed',
      startAt: { $gt: now, $lte: new Date(now.getTime() + lead) },
      $expr: { $lte: ['$createdAt', { $subtract: ['$startAt', lead] }] },
    },
    'startAt',
    async (b, session) => (await noticeBooking('booking_reminder', b, now, session)) > 0,
  );
}

/** Warns the customer of a payment-link hold that lapses within HOLD_WARNING_MINUTES. */
export async function warnExpiringHolds(now: Date): Promise<number> {
  const withLink = async (page: BookingDoc[]) => {
    const links = await Payment.find({
      bookingId: { $in: page.map((b) => b._id) },
      method: 'card',
      status: 'pending',
      kind: 'link',
    })
      .setOptions(cross)
      .select('bookingId');
    const linked = new Set(links.map((p) => String(p.bookingId)));
    return page.filter((b) => linked.has(String(b._id)));
  };
  return sweep(
    'warnExpiringHolds',
    { status: 'awaiting_payment', holdExpiresAt: { $gt: now, $lte: new Date(now.getTime() + HOLD_WARNING_MINUTES * MIN) } },
    'holdExpiresAt',
    async (b, session) => (await noticeBooking('hold_expiring', b, now, session)) > 0,
    withLink,
  );
}
