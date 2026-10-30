import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { MAX_BOOKINGS_PER_GROUP, MAX_SLOTS_PER_BOOKING, type BookingQuote, type EffectiveSettings } from '@booking/shared';
import { optionalAuth, requireAuth } from '../../auth/requireAuth';
import { normalizePhone } from '../../auth/normalize';
import { requestOtp, verifyOtp } from '../../auth/otp';
import { nameSchema } from '../../auth/routes/emailAuth';
import { otpCodeSchema } from '../../auth/routes/phoneAuth';
import type { Config } from '../../config';
import { AppError } from '../../errors';
import { isoDateSchema } from '../../schedule/schemas';
import type { AppServices } from '../../services';
import { effectiveForVenue } from '../../venues/effective';
import { publicTurf, publicVenueBySlug } from '../../venues/routes/public';
import { turfNotFound } from '../../venues/guards';
import { Turf, type TurfDoc } from '../../venues/turf.model';
import type { VenueDoc } from '../../venues/venue.model';
import { Booking, type BookingDoc } from '../booking.model';
import { playerBookingJson, playerBookingsJson } from '../playerJson';
import { createBooking, createBookingGroup, quoteFor, quoteGroup, type GroupItem } from '../create';
import { startIntent } from '../../payments/intent';
import { offeredMethods } from '../../payments/methods';
import { invalidTransition } from '../transition';
import { cancelBooking, previewCancellation } from '../cancel';
import { Refund } from '../../payments/refund.model';
import { refundJson } from '../../payments/refunds';

export const startAtsSchema = z
  .array(z.string().datetime({ offset: true }))
  .min(1)
  .max(MAX_SLOTS_PER_BOOKING)
  .transform((a) => a.map((s) => new Date(s)));

export const addonsSchema = z
  .array(z.object({ addonId: z.string().min(1), quantity: z.number().int().min(1).max(1000).optional() }).strict())
  .max(50)
  .default([]);

/** More bookings in the same checkout: each a run of slots on its own day and time, on the route's turf unless `turfId` names another of the venue. */
export const moreSchema = z
  .array(z.object({ turfId: z.string().min(1).max(64).optional(), date: isoDateSchema, startAts: startAtsSchema }).strict())
  .max(MAX_BOOKINGS_PER_GROUP - 1)
  .default([]);

type MoreItem = { turfId?: string; date: string; startAts: Date[] };

/**
 * Every item of a checkout, ordered by turf then start; a slot of a turf may appear in one item only.
 * Each further turf must be an active turf of the same venue.
 */
export async function groupItems(
  venue: VenueDoc,
  turf: TurfDoc,
  input: { date: string; startAts: Date[]; more: MoreItem[] },
): Promise<GroupItem[]> {
  const turfs = new Map([[String(turf._id), turf]]);
  for (const id of new Set(input.more.map((i) => i.turfId).filter((x): x is string => x !== undefined))) {
    if (turfs.has(id)) continue;
    const other = mongoose.isValidObjectId(id) ? await Turf.findOne({ ownerId: venue.ownerId, venueId: venue._id, _id: id, active: true }) : null;
    if (!other) throw turfNotFound();
    turfs.set(id, other);
  }
  const items = [{ turfId: String(turf._id), date: input.date, startAts: input.startAts }, ...input.more].map((i) => ({
    turf: turfs.get(i.turfId ?? String(turf._id))!,
    date: i.date,
    startAts: [...i.startAts].sort((a, b) => a.getTime() - b.getTime()),
  }));
  const all = items.flatMap((i) => i.startAts.map((d) => `${String(i.turf._id)}|${d.getTime()}`));
  if (new Set(all).size !== all.length) throw new AppError(400, 'validation_error', 'Each slot can be booked once');
  const first = String(turf._id);
  const rank = (i: GroupItem) => (String(i.turf._id) === first ? '' : String(i.turf._id));
  return items.sort((a, b) => rank(a).localeCompare(rank(b)) || a.startAts[0]!.getTime() - b.startAts[0]!.getTime());
}

const quoteSchema = z
  .object({ date: isoDateSchema, startAts: startAtsSchema, addons: addonsSchema, more: moreSchema })
  .strict();

const createSchema = z
  .object({
    date: isoDateSchema,
    startAts: startAtsSchema,
    addons: addonsSchema,
    more: moreSchema,
    guest: z.object({ name: nameSchema, phone: z.string().max(32), otpCode: otpCodeSchema.optional() }).strict().optional(),
  })
  .strict();

const otpSchema = z.object({ phone: z.string().max(32) }).strict();

/** POST bodies, never a query string: the phone would land in access logs and browser history. */
const lookupSchema = z.object({ reference: z.string().min(1).max(32), phone: z.string().min(1).max(32) }).strict();

/** Guests need the venue to allow them and no payment policy at all (a policy can demand an advance). */
const guestsAllowed = (s: EffectiveSettings) => s.guestBooking.allowed && s.paymentPolicy.type === 'none';

/** Unpaid holds one player may keep open at once, across venues: enough for one full group. */
export const MAX_OPEN_HOLDS = MAX_BOOKINGS_PER_GROUP;
/** Upcoming bookings one guest phone may have waiting on staff at once. */
export const MAX_GUEST_PENDING = 3;

const tooManyHolds = () =>
  new AppError(409, 'too_many_holds', 'You have too many unpaid or unconfirmed bookings; finish or cancel one first');

/** Refuses `adding` more bookings while a player's live unpaid holds would pass MAX_OPEN_HOLDS, so one player cannot hold every slot. */
async function assertHoldRoom(playerId: string, adding: number, now: Date) {
  const open = await Booking.countDocuments({ playerId, status: 'awaiting_payment', holdExpiresAt: { $gt: now } }).setOptions({
    crossTenant: true,
  });
  if (open > 0 && open + adding > MAX_OPEN_HOLDS) throw tooManyHolds();
}

/** Refuses a guest phone that already has MAX_GUEST_PENDING upcoming bookings waiting on staff. */
async function assertGuestRoom(phone: string, now: Date) {
  const pending = await Booking.countDocuments({ 'guest.phone': phone, status: 'pending', endAt: { $gt: now } }).setOptions({
    crossTenant: true,
  });
  if (pending >= MAX_GUEST_PENDING) throw tooManyHolds();
}

/** A client-made id for one checkout, sent again on every retry of it. */
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/, 'Use 8 to 100 letters, digits, - or _');

/** The Idempotency-Key header scoped to the booker, so one client's key can never reach another's bookings. */
function requestKeyOf(header: string | undefined, who: { playerId: string } | { phone: string }): string | undefined {
  if (header === undefined) return undefined;
  const key = idempotencyKeySchema.parse(header);
  return 'playerId' in who ? `player:${who.playerId}:${key}` : `guest:${who.phone}:${key}`;
}

/** The bookings an earlier request with this key made (the whole group for a group), or null. */
async function bookingsForKey(requestKey: string | undefined, turf: TurfDoc): Promise<BookingDoc[] | null> {
  if (requestKey === undefined) return null;
  const lead = await Booking.findOne({ requestKey }).setOptions({ crossTenant: true });
  if (!lead) return null;
  if (String(lead.turfId) !== String(turf._id)) {
    throw new AppError(422, 'idempotency_key_reused', 'This Idempotency-Key was used for a different booking');
  }
  if (!lead.groupId) return [lead];
  return Booking.find({ ownerId: lead.ownerId, groupId: lead.groupId }).sort({ _id: 1 });
}

const guestDisabled = () =>
  new AppError(403, 'guest_booking_disabled', 'Guest booking is not available at this venue');
const bookingNotFound = () => new AppError(404, 'not_found', 'Booking not found');

const cancelSchema = z.object({ reason: z.string().trim().max(300).optional() }).strict();
const guestCancelSchema = z
  .object({ reference: z.string().min(1).max(32), phone: z.string().min(1).max(32), otpCode: otpCodeSchema, reason: z.string().trim().max(300).optional() })
  .strict();
const guestOtpSchema = z.object({ reference: z.string().min(1).max(32), phone: z.string().min(1).max(32) }).strict();

/** The guest's booking by reference and phone. Same 404 for an unknown reference, a wrong phone and a malformed phone. */
async function guestBooking(reference: string, rawPhone: string, opts: { unowned?: boolean } = {}) {
  let phone: string;
  try {
    phone = normalizePhone(rawPhone);
  } catch {
    throw bookingNotFound();
  }
  const booking = await Booking.findOne({ reference: reference.trim().toUpperCase(), 'guest.phone': phone }).setOptions({
    crossTenant: true,
  });
  // A walk-in linked to a player carries guest.phone too; only that player may cancel it.
  if (!booking || (opts.unowned && booking.playerId)) throw bookingNotFound();
  return booking;
}

/** What a guest sees: a review belongs to the signed-in player, never to whoever holds the reference and phone. */
async function guestBookingJson(b: BookingDoc, now: Date) {
  return { ...(await playerBookingJson(b, now)), review: null, reviewableUntil: null };
}

const quoteJson = (q: BookingQuote, currency: string) => ({
  currency,
  slots: q.slots.map((s) => ({ startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(), price: s.price })),
  addons: q.addons,
  subtotal: q.subtotal,
  addonsTotal: q.addonsTotal,
  total: q.total,
  advanceRequired: q.advanceRequired,
});

/** Provider names only; the numbers are shown once the player has a booking to pay for. */
const methodsJson = (m: Awaited<ReturnType<typeof offeredMethods>>) => ({ wallets: m.wallets.map((w) => w.provider), card: m.card });

/** Player-facing booking routes. The app rate-limits the code-sending and lookup routes. */
export function publicBookingsRouter(config: Config, services: AppServices): Router {
  const router = Router();

  router.post('/venues/:slug/turfs/:turfId/quote', async (req, res) => {
    const input = quoteSchema.parse(req.body);
    const { venue, turf } = await publicTurf(req.params.slug, req.params.turfId);
    if (input.more.length > 0) {
      const { items, settings } = await quoteGroup({ venue, items: await groupItems(venue, turf, input), selection: input.addons, now: services.now() });
      const methods = await offeredMethods(String(venue.ownerId), venue, settings, { config, services });
      const sum = (key: 'total' | 'advanceRequired') => items.reduce((n, d) => n + d.quote[key], 0);
      res.json({
        quote: quoteJson(items[0]!.quote, venue.currency),
        items: items.map((d) => ({ turfId: d.turfId, date: d.date, quote: quoteJson(d.quote, venue.currency) })),
        total: sum('total'),
        advanceRequired: sum('advanceRequired'),
        // Several bookings at once are for signed-in players only.
        guestAllowed: false,
        guestOtpRequired: false,
        paymentMethods: methodsJson(methods),
      });
      return;
    }
    const { quote, settings } = await quoteFor({
      venue,
      turf,
      date: input.date,
      startAts: input.startAts,
      selection: input.addons,
      source: 'online',
      now: services.now(),
    });
    const methods = await offeredMethods(String(venue.ownerId), venue, settings, { config, services });
    res.json({
      quote: quoteJson(quote, venue.currency),
      guestAllowed: guestsAllowed(settings) && quote.advanceRequired === 0,
      guestOtpRequired: settings.guestBooking.requireOtp,
      paymentMethods: methodsJson(methods),
    });
  });

  // No slots here, so no advance to compute: any payment policy counts as "advance possible".
  router.post('/venues/:slug/bookings/otp', async (req, res) => {
    const { phone } = otpSchema.parse(req.body);
    const venue = await publicVenueBySlug(req.params.slug as string);
    const settings = await effectiveForVenue(String(venue.ownerId), venue);
    if (!guestsAllowed(settings)) throw guestDisabled();
    res.json(await requestOtp(normalizePhone(phone), 'guest_booking', services));
  });

  router.post(
    '/venues/:slug/turfs/:turfId/bookings',
    optionalAuth(config, services),
    async (req, res) => {
      const input = createSchema.parse(req.body);
      const userId = req.auth?.userId;
      if (userId && input.guest) {
        throw new AppError(400, 'validation_error', 'Signed-in players book as themselves; omit guest');
      }
      if (!userId && !input.guest) throw new AppError(401, 'unauthenticated', 'Sign in required');
      const { venue, turf } = await publicTurf(req.params.slug as string, req.params.turfId as string);
      const now = services.now();
      const base = { venue, turf, date: input.date, startAts: input.startAts, selection: input.addons, source: 'online' as const, now };
      const header = req.get('Idempotency-Key');
      const guestPhone = input.guest ? normalizePhone(input.guest.phone) : null;
      const requestKey = requestKeyOf(header, userId ? { playerId: userId } : { phone: guestPhone! });

      const send = async (bookings: BookingDoc[]) => {
        if (bookings.length > 1 || bookings[0]!.groupId) {
          const json = await playerBookingsJson(bookings, services.now());
          res.status(201).json({ booking: json[0], bookings: json });
        } else if (userId) {
          res.status(201).json({ booking: await playerBookingJson(bookings[0]!, services.now()) });
        } else {
          res.status(201).json({ booking: await guestBookingJson(bookings[0]!, services.now()) });
        }
      };
      // A retry gets what the first request made, before any cap or code check could refuse it.
      const earlier = await bookingsForKey(requestKey, turf);
      if (earlier) return send(earlier);

      try {
        await send(await create());
      } catch (err) {
        // Two copies of the same request raced: the loser (slot_taken, or the requestKey index)
        // answers with the winner's bookings.
        const won = await bookingsForKey(requestKey, turf);
        if (!won) throw err;
        await send(won);
      }

      async function create(): Promise<BookingDoc[]> {
        if (userId) await assertHoldRoom(userId, 1 + input.more.length, now);
        if (input.more.length > 0) {
          if (!userId) throw new AppError(401, 'unauthenticated', 'Sign in to book several times at once');
          const items = await groupItems(venue, turf, input);
          return createBookingGroup({ venue, items, selection: input.addons, now, requestKey, who: { playerId: userId, guest: null, createdBy: userId } });
        }

        if (userId) return [await createBooking({ ...base, requestKey, who: { playerId: userId, guest: null, createdBy: userId } })];

        const g = input.guest!;
        const phone = guestPhone!;
        const { quote, settings } = await quoteFor(base);
        // Disabled first, so a venue that refuses guests never consumes a code.
        if (!guestsAllowed(settings) || quote.advanceRequired > 0) throw guestDisabled();
        // Before the code too, so a refused booking never consumes one.
        await assertGuestRoom(phone, now);
        if (settings.guestBooking.requireOtp) {
          if (g.otpCode === undefined) throw new AppError(400, 'otp_required', 'A verification code is required');
          // Consumed here, before the transaction: a slot_taken race afterwards needs a new code.
          await verifyOtp(phone, 'guest_booking', g.otpCode, services);
        }
        return [
          await createBooking({
            ...base,
            requestKey,
            who: { playerId: null, guest: { name: g.name, phone }, createdBy: null },
          }),
        ];
      }
    },
  );

  router.post('/bookings/lookup', async (req, res) => {
    const q = lookupSchema.parse(req.body);
    res.json({ booking: await guestBookingJson(await guestBooking(q.reference, q.phone), services.now()) });
  });

  router.post('/bookings/lookup/cancellation', async (req, res) => {
    const q = lookupSchema.parse(req.body);
    const booking = await guestBooking(q.reference, q.phone, { unowned: true });
    res.json({ preview: await previewCancellation(booking, 'guest', services.now()) });
  });

  // Cancelling can move money, so a guest always needs a code, even where booking needs none.
  router.post('/bookings/lookup/otp', async (req, res) => {
    const q = guestOtpSchema.parse(req.body);
    const booking = await guestBooking(q.reference, q.phone, { unowned: true });
    // No SMS for a booking that cannot be cancelled.
    await previewCancellation(booking, 'guest', services.now());
    res.json(await requestOtp(booking.guest!.phone, 'guest_cancel', services));
  });

  router.post('/bookings/lookup/cancel', async (req, res) => {
    const q = guestCancelSchema.parse(req.body);
    const booking = await guestBooking(q.reference, q.phone, { unowned: true });
    // Before the code, so a 404 or 409 never checks or consumes it.
    await previewCancellation(booking, 'guest', services.now());
    await verifyOtp(booking.guest!.phone, 'guest_cancel', q.otpCode, services);
    const out = await cancelBooking(booking, { kind: 'guest', ownerId: String(booking.ownerId) }, { reason: q.reason || undefined }, { config, services });
    res.json({ booking: await guestBookingJson(out.booking, services.now()), refunds: out.refunds.map(refundJson) });
  });

  router.get('/me/bookings', requireAuth(config, services), async (req, res) => {
    // Rejected series games are summarized by the series card. Window around now so a long series cannot hide near bookings.
    const now = services.now();
    const mine = { playerId: req.auth!.userId, $nor: [{ seriesId: { $ne: null }, status: 'rejected' }] };
    const [upcoming, past] = await Promise.all([
      Booking.find({ ...mine, endAt: { $gt: now } }).setOptions({ crossTenant: true }).sort({ startAt: 1 }).limit(100),
      Booking.find({ ...mine, endAt: { $lte: now } }).setOptions({ crossTenant: true }).sort({ startAt: -1 }).limit(100),
    ]);
    const bookings = [...upcoming, ...past];
    res.json({ bookings: await playerBookingsJson(bookings, services.now()) });
  });

  /** The player's own booking, else 404 (never 403, so ids don't leak). */
  async function playerBooking(bookingId: string, userId: string) {
    const booking = mongoose.isValidObjectId(bookingId)
      ? await Booking.findOne({ _id: bookingId, playerId: userId }).setOptions({ crossTenant: true })
      : null;
    if (!booking) throw bookingNotFound();
    return booking;
  }

  router.get('/me/bookings/:bookingId', requireAuth(config, services), async (req, res) => {
    const booking = await playerBooking(req.params.bookingId as string, req.auth!.userId);
    const [refunds, group] = await Promise.all([
      Refund.find({ ownerId: booking.ownerId, bookingId: booking._id }).sort({ _id: 1 }),
      // The other days booked in the same go, so the player sees all of them from any one.
      booking.groupId
        ? Booking.find({ ownerId: booking.ownerId, playerId: req.auth!.userId, groupId: booking.groupId, _id: { $ne: booking._id } }).sort({
            startAt: 1,
          })
        : [],
    ]);
    res.json({
      booking: await playerBookingJson(booking, services.now()),
      refunds: refunds.map(refundJson),
      group: await playerBookingsJson(group, services.now()),
    });
  });

  router.get('/me/bookings/:bookingId/cancellation', requireAuth(config, services), async (req, res) => {
    const booking = await playerBooking(req.params.bookingId as string, req.auth!.userId);
    res.json({ preview: await previewCancellation(booking, 'player', services.now()) });
  });

  router.post('/me/bookings/:bookingId/cancel', requireAuth(config, services), async (req, res) => {
    const { reason } = cancelSchema.parse(req.body ?? {});
    const userId = req.auth!.userId;
    const booking = await playerBooking(req.params.bookingId as string, userId);
    const by = { kind: 'player' as const, ownerId: String(booking.ownerId), userId };
    const out = await cancelBooking(booking, by, { reason: reason || undefined }, { config, services });
    res.json({ booking: await playerBookingJson(out.booking, services.now()), refunds: out.refunds.map(refundJson) });
  });

  router.post('/bookings/:bookingId/payment', requireAuth(config, services), async (req, res) => {
    const { bookingId } = req.params;
    const booking = mongoose.isValidObjectId(bookingId)
      ? await Booking.findOne({ _id: bookingId, playerId: req.auth!.userId }).setOptions({ crossTenant: true })
      : null;
    if (!booking) throw bookingNotFound();
    if (booking.status !== 'awaiting_payment') throw invalidTransition(booking.status);
    const { payment, amount, clientSecret, publishableKey } = await startIntent(booking, { config, services });
    res.json({
      payment: {
        id: String(payment._id),
        amount,
        currency: payment.currency,
        gateway: 'stripe',
        clientSecret,
        publishableKey,
      },
      holdExpiresAt: booking.holdExpiresAt!.toISOString(),
    });
  });

  return router;
}
