import { Router } from 'express';
import mongoose from 'mongoose';
import type { AppServices } from '../../services';
import { turfNotFound } from '../../venues/guards';
import { publicVenueBySlug } from '../../venues/routes/public';
import { Turf } from '../../venues/turf.model';
import { inWindow, loadDay, publicSlotJson, slotJson } from '../load';
import { parseDate } from './slots';

/** Unauthenticated slot grid of one active turf of a published venue. */
export function publicSlotsRouter(services: AppServices): Router {
  const router = Router();

  router.get('/venues/:slug/turfs/:turfId/slots', async (req, res) => {
    const venue = await publicVenueBySlug(req.params.slug);
    const { turfId } = req.params;
    const turf = mongoose.isValidObjectId(turfId)
      ? await Turf.findOne({ ownerId: venue.ownerId, venueId: venue._id, _id: turfId, active: true })
      : null;
    if (!turf) throw turfNotFound();
    const date = parseDate(req.query.date);
    const now = services.now();
    const { day, settings } = await loadDay(String(venue.ownerId), venue, turf, date, now);
    // Closed wins over outside_window: a closed day is closed whenever it is asked about.
    const status = day.closed ? 'closed' : inWindow(date, now, venue.timezone, settings.bookingWindowDays) ? 'open' : 'outside_window';
    res.json({
      day: {
        businessDate: day.businessDate,
        currency: venue.currency,
        status,
        slots: status === 'open' ? day.slots.map((s) => publicSlotJson(slotJson(s))) : [],
      },
    });
  });

  return router;
}
