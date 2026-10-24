import { Router } from 'express';
import mongoose from 'mongoose';
import { turfNotFound } from '../../venues/guards';
import { publicVenueBySlug } from '../../venues/routes/public';
import { Turf } from '../../venues/turf.model';
import { offeredAddons, offeredJson } from '../offered';

/** Unauthenticated add-ons offered on one active turf of a published venue. */
export function publicAddonsRouter(): Router {
  const router = Router();

  router.get('/venues/:slug/turfs/:turfId/addons', async (req, res) => {
    const venue = await publicVenueBySlug(req.params.slug);
    const { turfId } = req.params;
    const turf = mongoose.isValidObjectId(turfId)
      ? await Turf.findOne({ ownerId: venue.ownerId, venueId: venue._id, _id: turfId, active: true })
      : null;
    if (!turf) throw turfNotFound();
    const addons = await offeredAddons(String(venue.ownerId), venue, turf);
    res.json({ currency: venue.currency, addons: addons.map(offeredJson) });
  });

  return router;
}
