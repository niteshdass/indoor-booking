import type { ClientSession } from 'mongoose';
import { reviewerName, type Locale, type SeriesClashReason } from '@booking/shared';
import type { Config } from '../config';
import { User } from '../auth/user.model';
import { Booking, type BookingDoc } from '../bookings/booking.model';
import type { AppServices } from '../services';
import { Membership } from '../tenancy/membership.model';
import { Owner } from '../tenancy/owner.model';
import { Role } from '../tenancy/role.model';
import { Turf } from '../venues/turf.model';
import { Venue } from '../venues/venue.model';
import { Notification } from './notification.model';
import { renderNotice, type NoticeData, type NoticeEvent } from './templates';

export const MAX_NOTICE_ATTEMPTS = 5;
const DELIVER_BATCH = 100;
/** A run stops claiming rows after this long, so a hanging provider cannot hold the runner past its lease. */
export const DELIVER_BUDGET_MS = 60_000;

const cross = { crossTenant: true };

type Recipient = { channel: 'email' | 'sms'; to: string };

/** Minutes to wait after attempt n: 1, 2, 4, 8. */
const backoffMs = (attempt: number) => 2 ** (attempt - 1) * 60_000;

/** Verified contacts of a player; an unverified address or number gets nothing. */
function contactsOf(user: { email?: string | null; emailVerified?: boolean; phone?: string | null; phoneVerified?: boolean }): Recipient[] {
  const out: Recipient[] = [];
  if (user.email && user.emailVerified) out.push({ channel: 'email', to: user.email });
  if (user.phone && user.phoneVerified) out.push({ channel: 'sms', to: user.phone });
  return out;
}

const SERIES_GAMES_LISTED = 30;
const isSeriesEvent = (event: NoticeEvent) => event.startsWith('series_');

const COMMENT_MAX = 140;
const clip = (s: string) => (s.length > COMMENT_MAX ? `${s.slice(0, COMMENT_MAX - 1)}…` : s);

/** Active members holding `permission` at the booking's venue: email if they have one, else SMS. */
async function staffRecipients(booking: BookingDoc, permission: string, session: ClientSession): Promise<Recipient[]> {
  const ownerId = String(booking.ownerId);
  const roles = await Role.find({ permissions: permission }).setOptions({ ...cross, session }).select('_id');
  const members = await Membership.find({
    ownerId,
    status: 'active',
    roleId: { $in: roles.map((r) => r._id) },
    $or: [{ allVenues: true }, { venueIds: booking.venueId }],
  }).session(session);
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).session(session);
  const out: Recipient[] = [];
  for (const u of users) {
    if (u.email) out.push({ channel: 'email', to: u.email });
    else if (u.phone) out.push({ channel: 'sms', to: u.phone });
  }
  return out;
}

/**
 * Queues the notices an event calls for, inside the caller's transaction. Idempotent: a repeat
 * inserts nothing (upsert, so a duplicate never aborts the transaction). Returns the rows inserted.
 */
export async function noticeBooking(
  event: NoticeEvent,
  booking: BookingDoc,
  now: Date,
  session: ClientSession,
  extra: {
    amount?: number; reason?: string | null; autoRejected?: boolean; refundId?: string; stars?: number; comment?: string | null;
    seriesId?: string;
    games?: string[];
    skipped?: { date: string; reason: SeriesClashReason }[];
    kept?: string[];
    /** Series events that go to staff instead of the player. */
    toStaff?: boolean;
  } = {},
): Promise<number> {
  const ownerId = String(booking.ownerId);
  // One at a time: a transaction session cannot run operations in parallel.
  const venue = await Venue.findOne({ ownerId, _id: booking.venueId }).session(session);
  const turf = await Turf.findOne({ ownerId, _id: booking.turfId }).session(session);
  const owner = await Owner.findById(ownerId).session(session);
  const player = booking.playerId ? await User.findById(booking.playerId).session(session) : null;
  if (!venue || !turf || !owner) throw new Error('Booking venue, turf or owner is missing');

  const data: NoticeData = {
    bookingId: String(booking._id),
    reference: booking.reference,
    venueName: venue.name,
    turfName: turf.name,
    timezone: venue.timezone,
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    currency: booking.currency,
    ...(extra.amount === undefined ? {} : { amount: extra.amount }),
    ...(extra.reason === undefined ? {} : { reason: extra.reason }),
    ...(extra.autoRejected ? { autoRejected: true } : {}),
    customerName:
      event === 'review_posted' ? (reviewerName(player?.name) ?? undefined) : (booking.guest?.name ?? player?.name ?? undefined),
    ...(event === 'review_posted' ? { ownerId } : {}),
    ...(extra.stars === undefined ? {} : { stars: extra.stars }),
    ...(extra.comment ? { comment: clip(extra.comment) } : {}),
    ...(isSeriesEvent(event)
      ? {
          ownerId,
          ...(extra.seriesId ? { seriesId: extra.seriesId } : {}),
          games: (extra.games ?? []).slice(0, SERIES_GAMES_LISTED),
          ...((extra.games?.length ?? 0) > SERIES_GAMES_LISTED ? { moreGames: extra.games!.length - SERIES_GAMES_LISTED } : {}),
          ...(extra.skipped?.length ? { skipped: extra.skipped } : {}),
          ...(extra.kept?.length ? { kept: extra.kept } : {}),
          ...(extra.toStaff ? { toStaff: true } : {}),
        }
      : {}),
    ...(booking.holdExpiresAt ? { holdExpiresAt: booking.holdExpiresAt.toISOString() } : {}),
  };

  let recipients: Recipient[];
  if (event === 'series_requested' || (event === 'series_games_cancelled' && extra.toStaff)) {
    recipients = await staffRecipients(booking, 'booking.confirm', session);
  } else if (event === 'staff_new_pending') recipients = await staffRecipients(booking, 'booking.confirm', session);
  else if (event === 'review_posted') recipients = await staffRecipients(booking, 'review.manage', session);
  else if (player) recipients = contactsOf(player);
  else recipients = booking.guest ? [{ channel: 'sms', to: booking.guest.phone }] : [];

  let inserted = 0;
  for (const r of recipients) {
    const dedupeKey = [event, String(booking._id), extra.refundId ?? '', r.channel, r.to].join(':');
    const res = await Notification.updateOne(
      { ownerId, dedupeKey },
      {
        $setOnInsert: {
          ownerId,
          bookingId: booking._id,
          event,
          channel: r.channel,
          to: r.to,
          locale: owner.defaultLocale as Locale,
          data,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: now,
          lastError: null,
          sentAt: null,
          dedupeKey,
        },
      },
      { upsert: true, session },
    );
    inserted += res.upsertedCount;
  }
  return inserted;
}

/** True when the thing the notice is about no longer holds, so sending it would mislead. */
async function isStale(event: NoticeEvent, ownerId: unknown, bookingId: unknown): Promise<boolean> {
  if (event === 'review_request') {
    const booking = await Booking.findOne({ ownerId, _id: bookingId }).select('status reviewedAt');
    return !booking || !!booking.reviewedAt || booking.status !== 'completed';
  }
  const wanted = event === 'booking_reminder' ? 'confirmed' : event === 'hold_expiring' ? 'awaiting_payment' : null;
  if (!wanted) return false;
  const booking = await Booking.findOne({ ownerId, _id: bookingId }).select('status');
  return booking?.status !== wanted;
}

/**
 * Sweeper: sends due notices, retrying a failing one with backoff until MAX_NOTICE_ATTEMPTS. Stops
 * claiming after DELIVER_BUDGET_MS; rows it did not claim stay pending for the next tick.
 */
export async function deliverNotifications(
  now: Date,
  deps: { config: Config; services: AppServices },
): Promise<{ sent: number; failed: number; dropped: number }> {
  const due = await Notification.find({ status: 'pending', nextAttemptAt: { $lte: now } })
    .setOptions(cross)
    .sort({ nextAttemptAt: 1 })
    .limit(DELIVER_BATCH);
  const result = { sent: 0, failed: 0, dropped: 0 };
  const started = deps.services.now().getTime();
  for (const row of due) {
    const claimNow = deps.services.now();
    if (claimNow.getTime() - started > DELIVER_BUDGET_MS) break;
    const mine = { ownerId: row.ownerId, _id: row._id };
    try {
      // Compare-and-set on the attempt count: of two concurrent deliverers only one gets the row. The
      // backoff runs from the claim, not the tick, so a row claimed late in a slow run is not due again
      // while it is still being sent.
      const claimed = await Notification.findOneAndUpdate(
        { ...mine, status: 'pending', attempts: row.attempts, nextAttemptAt: { $lte: claimNow } },
        { $inc: { attempts: 1 }, $set: { nextAttemptAt: new Date(claimNow.getTime() + backoffMs(row.attempts + 1)) } },
        { new: true },
      );
      if (!claimed) continue;
      try {
        if (row.bookingId && (await isStale(row.event, row.ownerId, row.bookingId))) {
          await Notification.updateOne(mine, { $set: { status: 'failed', lastError: 'stale' } });
          result.dropped += 1;
          continue;
        }
        const msg = renderNotice(row.event, row.locale, row.data as NoticeData, deps.config.appUrl);
        if (row.channel === 'email') await deps.services.email.send({ to: row.to, subject: msg.subject, text: msg.text });
        else await deps.services.sms.send(row.to, msg.sms);
        await Notification.updateOne(mine, { $set: { status: 'sent', sentAt: claimNow, lastError: null } });
        result.sent += 1;
      } catch (err) {
        const final = claimed.attempts >= MAX_NOTICE_ATTEMPTS;
        await Notification.updateOne(mine, {
          $set: { lastError: err instanceof Error ? err.message : String(err), ...(final ? { status: 'failed' } : {}) },
        });
        result.failed += 1;
      }
    } catch (err) {
      console.error(`[notifications] delivery of ${String(row._id)} failed`, err);
    }
  }
  return result;
}
