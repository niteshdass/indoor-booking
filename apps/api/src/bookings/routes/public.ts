import { Router, type RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { MAX_SLOTS_PER_BOOKING, type BookingQuote, type EffectiveSettings } from '@booking/shared';
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
import { Booking } from '../booking.model';
import { playerBookingJson, playerBookingsJson } from '../playerJson';
import { createBooking, quoteFor } from '../create';
import { startIntent } from '../../payments/intent';
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

const quoteSchema = z.object({ date: isoDateSchema, startAts: startAtsSchema, addons: addonsSchema }).strict();

const createSchema = z
  .object({
    date: isoDateSchema,
    startAts: startAtsSchema,
    addons: addonsSchema,
    guest: z.object({ name: nameSchema, phone: z.string().max(32), otpCode: otpCodeSchema.optional() }).strict().optional(),
  })
  .strict();

const otpSchema = z.object({ phone: z.string().max(32) }).strict();

const lookupQuery = z.object({ reference: z.string().min(1).max(32), phone: z.string().min(1).max(32) });

/** Guests need the venue to allow them and no payment policy at all (a policy can demand an advance). */
const guestsAllowed = (s: EffectiveSettings) => s.guestBooking.allowed && s.paymentPolicy.type === 'none';

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

const quoteJson = (q: BookingQuote, currency: string) => ({
  currency,
  slots: q.slots.map((s) => ({ startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(), price: s.price })),
  addons: q.addons,
  subtotal: q.subtotal,
  addonsTotal: q.addonsTotal,
  total: q.total,
  advanceRequired: q.advanceRequired,
});

/**
 * Player-facing booking routes. `otpLimiter` guards the SMS-sending guest OTP route (the caller
 * passes it only when rate limiting is on).
 */
export function publicBookingsRouter(
  config: Config,
  services: AppServices,
  otpLimiter?: RequestHandler,
): Router {
  const router = Router();

  router.post('/venues/:slug/turfs/:turfId/quote', async (req, res) => {
    const input = quoteSchema.parse(req.body);
    const { venue, turf } = await publicTurf(req.params.slug, req.params.turfId);
    const { quote, settings } = await quoteFor({
      venue,
      turf,
      date: input.date,
      startAts: input.startAts,
      selection: input.addons,
      source: 'online',
      now: services.now(),
    });
    res.json({
      quote: quoteJson(quote, venue.currency),
      guestAllowed: guestsAllowed(settings) && quote.advanceRequired === 0,
      guestOtpRequired: settings.guestBooking.requireOtp,
    });
  });

  // No slots here, so no advance to compute: any payment policy counts as "advance possible".
  router.post('/venues/:slug/bookings/otp', ...(otpLimiter ? [otpLimiter] : []), async (req, res) => {
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

      if (userId) {
        const booking = await createBooking({ ...base, who: { playerId: userId, guest: null, createdBy: userId } });
        res.status(201).json({ booking: await playerBookingJson(booking, services.now()) });
        return;
      }

      const g = input.guest!;
      const phone = normalizePhone(g.phone);
      const { quote, settings } = await quoteFor(base);
      // Disabled first, so a venue that refuses guests never consumes a code.
      if (!guestsAllowed(settings) || quote.advanceRequired > 0) throw guestDisabled();
      if (settings.guestBooking.requireOtp) {
        if (g.otpCode === undefined) throw new AppError(400, 'otp_required', 'A verification code is required');
        // Consumed here, before the transaction: a slot_taken race afterwards needs a new code.
        await verifyOtp(phone, 'guest_booking', g.otpCode, services);
      }
      const booking = await createBooking({
        ...base,
        who: { playerId: null, guest: { name: g.name, phone }, createdBy: null },
      });
      res.status(201).json({ booking: await playerBookingJson(booking, services.now()) });
    },
  );

  router.get('/bookings/lookup', async (req, res) => {
    const q = lookupQuery.parse(req.query);
    res.json({ booking: await playerBookingJson(await guestBooking(q.reference, q.phone), services.now()) });
  });

  router.get('/bookings/lookup/cancellation', async (req, res) => {
    const q = lookupQuery.parse(req.query);
    const booking = await guestBooking(q.reference, q.phone, { unowned: true });
    res.json({ preview: await previewCancellation(booking, 'guest', services.now()) });
  });

  // Cancelling can move money, so a guest always needs a code, even where booking needs none.
  router.post('/bookings/lookup/otp', ...(otpLimiter ? [otpLimiter] : []), async (req, res) => {
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
    res.json({ booking: await playerBookingJson(out.booking, services.now()), refunds: out.refunds.map(refundJson) });
  });

  router.get('/me/bookings', requireAuth(config, services), async (req, res) => {
    const bookings = await Booking.find({ playerId: req.auth!.userId })
      .setOptions({ crossTenant: true })
      .sort({ startAt: -1 })
      .limit(100);
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
    const refunds = await Refund.find({ ownerId: booking.ownerId, bookingId: booking._id }).sort({ _id: 1 });
    res.json({ booking: await playerBookingJson(booking, services.now()), refunds: refunds.map(refundJson) });
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
    const { payment, clientSecret, publishableKey } = await startIntent(booking, { config, services });
    res.json({
      payment: {
        id: String(payment._id),
        amount: payment.amount,
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
