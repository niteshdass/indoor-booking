import { Router, type RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { MAX_SLOTS_PER_BOOKING, type BookingQuote } from '@booking/shared';
import { optionalAuth, requireAuth } from '../../auth/requireAuth';
import { normalizePhone } from '../../auth/normalize';
import { requestOtp, verifyOtp } from '../../auth/otp';
import { nameSchema } from '../../auth/routes/emailAuth';
import { otpCodeSchema } from '../../auth/routes/phoneAuth';
import type { Config } from '../../config';
import { AppError } from '../../errors';
import { isoDateSchema } from '../../schedule/schemas';
import type { AppServices } from '../../services';
import { turfNotFound } from '../../venues/guards';
import { effectiveForVenue } from '../../venues/effective';
import { publicVenueBySlug } from '../../venues/routes/public';
import { Turf } from '../../venues/turf.model';
import { Booking, bookingJson } from '../booking.model';
import { createBooking, quoteFor } from '../create';

const startAtsSchema = z
  .array(z.string().datetime({ offset: true }))
  .min(1)
  .max(MAX_SLOTS_PER_BOOKING)
  .transform((a) => a.map((s) => new Date(s)));

const addonsSchema = z
  .array(z.object({ addonId: z.string().min(1), quantity: z.number().int().min(1).max(1000).optional() }).strict())
  .max(50)
  .default([]);

const quoteSchema = z.object({ date: isoDateSchema, startAts: startAtsSchema, addons: addonsSchema }).strict();

const createSchema = z
  .object({
    date: isoDateSchema,
    startAts: startAtsSchema,
    addons: addonsSchema,
    guest: z.object({ name: nameSchema, phone: z.string(), otpCode: otpCodeSchema.optional() }).strict().optional(),
  })
  .strict();

const otpSchema = z.object({ phone: z.string() }).strict();

const lookupQuery = z.object({ reference: z.string().min(1).max(32), phone: z.string().min(1).max(32) });

const guestDisabled = () =>
  new AppError(403, 'guest_booking_disabled', 'Guest booking is not available at this venue');
const bookingNotFound = () => new AppError(404, 'not_found', 'Booking not found');

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

  /** Published venue, active owner, active turf, else 404 (same lookup as the public slot grid). */
  async function publicTurf(slug: string, turfId: string) {
    const venue = await publicVenueBySlug(slug);
    const turf = mongoose.isValidObjectId(turfId)
      ? await Turf.findOne({ ownerId: venue.ownerId, venueId: venue._id, _id: turfId, active: true })
      : null;
    if (!turf) throw turfNotFound();
    return { venue, turf };
  }

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
      guestAllowed: settings.guestBooking.allowed && quote.advanceRequired === 0,
      guestOtpRequired: settings.guestBooking.requireOtp,
    });
  });

  // No slots here, so no advance to compute: any payment policy counts as "advance possible".
  router.post('/venues/:slug/bookings/otp', ...(otpLimiter ? [otpLimiter] : []), async (req, res) => {
    const { phone } = otpSchema.parse(req.body);
    const venue = await publicVenueBySlug(req.params.slug as string);
    const settings = await effectiveForVenue(String(venue.ownerId), venue);
    if (!settings.guestBooking.allowed || settings.paymentPolicy.type !== 'none') throw guestDisabled();
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
        res.status(201).json({ booking: bookingJson(booking) });
        return;
      }

      const g = input.guest!;
      const phone = normalizePhone(g.phone);
      const { quote, settings } = await quoteFor(base);
      // Disabled first, so a venue that refuses guests never consumes a code.
      if (!settings.guestBooking.allowed || quote.advanceRequired > 0) throw guestDisabled();
      if (settings.guestBooking.requireOtp) {
        if (g.otpCode === undefined) throw new AppError(400, 'otp_required', 'A verification code is required');
        await verifyOtp(phone, 'guest_booking', g.otpCode, services);
      }
      const booking = await createBooking({
        ...base,
        who: { playerId: null, guest: { name: g.name, phone }, createdBy: null },
      });
      res.status(201).json({ booking: bookingJson(booking) });
    },
  );

  router.get('/bookings/lookup', async (req, res) => {
    const q = lookupQuery.parse(req.query);
    const phone = normalizePhone(q.phone);
    // Same 404 for an unknown reference and a wrong phone.
    const booking = await Booking.findOne({ reference: q.reference.trim().toUpperCase(), 'guest.phone': phone }).setOptions({
      crossTenant: true,
    });
    if (!booking) throw bookingNotFound();
    res.json({ booking: bookingJson(booking) });
  });

  router.get('/me/bookings', requireAuth(config, services), async (req, res) => {
    const bookings = await Booking.find({ playerId: req.auth!.userId })
      .setOptions({ crossTenant: true })
      .sort({ startAt: -1 })
      .limit(100);
    res.json({ bookings: bookings.map(bookingJson) });
  });

  router.get('/me/bookings/:bookingId', requireAuth(config, services), async (req, res) => {
    const { bookingId } = req.params;
    const booking = mongoose.isValidObjectId(bookingId)
      ? await Booking.findOne({ _id: bookingId, playerId: req.auth!.userId }).setOptions({ crossTenant: true })
      : null;
    if (!booking) throw bookingNotFound();
    res.json({ booking: bookingJson(booking) });
  });

  return router;
}
