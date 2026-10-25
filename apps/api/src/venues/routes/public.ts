import { Router } from 'express';
import { ratingJson } from '../../reviews/rating';
import { SLUG_RE } from '@booking/shared';
import { AppError } from '../../errors';
import { Owner } from '../../tenancy/owner.model';
import { Venue, type VenueDoc } from '../venue.model';
import { Turf } from '../turf.model';

const notFound = () => new AppError(404, 'not_found', 'Venue not found');

/** The published venue of an active owner, else 404; shared by every public venue endpoint. */
export async function publicVenueBySlug(slug: string): Promise<VenueDoc> {
  if (!SLUG_RE.test(slug)) throw notFound();
  // Public read by slug across tenants: the one cross-tenant venue lookup the spec allows.
  const venue = await Venue.findOne({ slug, published: true }).setOptions({ crossTenant: true });
  if (!venue) throw notFound();
  // A suspended or not-yet-approved owner's venues leave the player side too.
  const owner = await Owner.findById(venue.ownerId, { status: 1 }).lean();
  if (owner?.status !== 'active') throw notFound();
  return venue;
}

/** Unauthenticated venue page; unpublished, unknown and malformed slugs all look the same. */
export function publicVenuesRouter(): Router {
  const router = Router();

  router.get('/venues/:slug', async (req, res) => {
    const venue = await publicVenueBySlug(req.params.slug);
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
        rating: ratingJson(venue.rating),
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
