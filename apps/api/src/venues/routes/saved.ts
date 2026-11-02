import { Router } from 'express';
import { MAX_SAVED_VENUES, SLUG_RE, SPORTS, type SavedVenueJson } from '@booking/shared';
import { requireAuth } from '../../auth/requireAuth';
import type { Config } from '../../config';
import { isDuplicateKeyError } from '../../db';
import { AppError } from '../../errors';
import { ratingJson } from '../../reviews/rating';
import type { AppServices } from '../../services';
import { Owner } from '../../tenancy/owner.model';
import { SavedVenue } from '../savedVenue.model';
import { Turf } from '../turf.model';
import { Venue } from '../venue.model';
import { publicVenueBySlug } from './public';

const cross = { crossTenant: true };

const full = () =>
  new AppError(409, 'saved_venues_full', `A player can save at most ${MAX_SAVED_VENUES} venues`);

/** The signed-in player's saved venues; venues are looked up across tenants by slug, like the venue page. */
export function savedVenuesRouter(config: Config, services: AppServices): Router {
  const router = Router();
  router.use('/me/saved-venues', requireAuth(config, services));

  /** Newest first; venues unpublished since, or of a suspended owner, drop out until they come back. */
  router.get('/me/saved-venues', async (req, res) => {
    const saves = await SavedVenue.find({ userId: req.auth!.userId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(MAX_SAVED_VENUES)
      .lean();
    const ids = saves.map((s) => s.venueId);
    const venues = await Venue.find({ _id: { $in: ids }, published: true }).setOptions(cross).lean();
    const owners = await Owner.find({ _id: { $in: venues.map((v) => v.ownerId) }, status: 'active' }, { _id: 1 }).lean();
    const active = new Set(owners.map((o) => String(o._id)));
    const turfs = await Turf.find({ venueId: { $in: venues.map((v) => v._id) }, active: true }, { venueId: 1, sports: 1 })
      .setOptions(cross)
      .lean();
    const byId = new Map(venues.filter((v) => active.has(String(v.ownerId))).map((v) => [String(v._id), v]));
    const out: SavedVenueJson[] = [];
    for (const s of saves) {
      const venue = byId.get(String(s.venueId));
      if (!venue) continue;
      const sports = new Set(turfs.filter((t) => String(t.venueId) === String(venue._id)).flatMap((t) => t.sports));
      const photo = venue.photos[0];
      out.push({
        slug: venue.slug,
        name: venue.name,
        address: venue.address,
        city: venue.city,
        photo: photo ? { url: photo.url, ...(photo.alt ? { alt: photo.alt } : {}) } : null,
        sports: SPORTS.filter((sport) => sports.has(sport)),
        rating: ratingJson(venue.rating),
        savedAt: s.createdAt!.toISOString(),
      });
    }
    res.json({ venues: out });
  });

  router.get('/me/saved-venues/:slug', async (req, res) => {
    const venue = await publicVenueBySlug(req.params.slug);
    const saved = await SavedVenue.exists({ userId: req.auth!.userId, venueId: venue._id });
    res.json({ saved: !!saved });
  });

  /** Saving twice is fine. */
  router.put('/me/saved-venues/:slug', async (req, res) => {
    const userId = req.auth!.userId;
    const venue = await publicVenueBySlug(req.params.slug);
    if (await SavedVenue.exists({ userId, venueId: venue._id })) return void res.json({ saved: true });
    if ((await SavedVenue.countDocuments({ userId })) >= MAX_SAVED_VENUES) throw full();
    try {
      await SavedVenue.create({ userId, venueId: venue._id });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
    }
    res.json({ saved: true });
  });

  /** Works on a venue that has left the player side too, so the list can always be tidied. */
  router.delete('/me/saved-venues/:slug', async (req, res) => {
    const { slug } = req.params;
    const venue = SLUG_RE.test(slug) ? await Venue.findOne({ slug }, { _id: 1 }).setOptions(cross).lean() : null;
    if (venue) await SavedVenue.deleteOne({ userId: req.auth!.userId, venueId: venue._id });
    res.status(204).end();
  });

  return router;
}
