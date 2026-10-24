import { Router } from 'express';
import { SLUG_RE } from '@booking/shared';
import { AppError } from '../../errors';
import { Venue } from '../venue.model';
import { Turf } from '../turf.model';

const notFound = () => new AppError(404, 'not_found', 'Venue not found');

/** Unauthenticated venue page; unpublished, unknown and malformed slugs all look the same. */
export function publicVenuesRouter(): Router {
  const router = Router();

  router.get('/venues/:slug', async (req, res) => {
    const { slug } = req.params;
    if (!SLUG_RE.test(slug)) throw notFound();
    // Public read by slug across tenants: the one cross-tenant venue lookup the spec allows.
    const venue = await Venue.findOne({ slug, published: true }).setOptions({ crossTenant: true });
    if (!venue) throw notFound();
    const turfs = await Turf.find({ ownerId: venue.ownerId, venueId: venue._id, active: true })
      .sort({ name: 1 })
      .collation({ locale: 'en', strength: 2 });
    const [lng, lat] = venue.location!.coordinates;
    res.json({
      venue: {
        slug: venue.slug,
        name: venue.name,
        address: venue.address,
        city: venue.city,
        country: venue.country,
        currency: venue.currency,
        timezone: venue.timezone,
        location: { lat, lng },
        photos: venue.photos.map((p) => (p.alt == null ? { url: p.url } : { url: p.url, alt: p.alt })),
        amenities: venue.amenities,
        turfs: turfs.map((t) => ({
          id: t.id as string,
          name: t.name,
          sports: t.sports,
          indoor: t.indoor,
          slotLengthMin: t.slotLengthMin,
        })),
      },
    });
  });

  return router;
}
