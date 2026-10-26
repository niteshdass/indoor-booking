import type { PipelineStage } from 'mongoose';
import { Owner } from '../tenancy/owner.model';
import { Venue, type VenueDoc } from '../venues/venue.model';
import { Turf, type TurfDoc } from '../venues/turf.model';
import type { SearchQuery } from './query';

export type Candidate = { venue: VenueDoc; turfs: TurfDoc[]; distanceMeters: number | null };

type Row = Record<string, unknown> & { turfs: Record<string, unknown>[]; distanceMeters?: number };

/** Top rated first when asked (unrated last), otherwise nearest first, or by name without a location. */
function sortStage(q: SearchQuery): Record<string, 1 | -1> {
  if (q.sort === 'rating') return { 'rating.average': -1, 'rating.count': -1, name: 1, _id: 1 };
  return q.near ? { distanceMeters: 1, _id: 1 } : { name: 1, _id: 1 };
}

/**
 * Published venues of active owners that have at least one active turf matching the sport and
 * indoor filters, nearest first (or by name without a location). Reads across every tenant.
 */
export async function findCandidates(q: SearchQuery, skip: number, n: number): Promise<Candidate[]> {
  const venueMatch: Record<string, unknown> = { published: true };
  if (q.currency) venueMatch.currency = q.currency;
  if (q.bbox) {
    const { west, south, east, north } = q.bbox;
    venueMatch['location.coordinates.1'] = { $gte: south, $lte: north };
    const lng = 'location.coordinates.0';
    if (west < east) venueMatch[lng] = { $gte: west, $lte: east };
    else venueMatch.$or = [{ [lng]: { $gte: west } }, { [lng]: { $lte: east } }];
  }

  const turfMatch: Record<string, unknown> = {
    $expr: { $and: [{ $eq: ['$ownerId', '$$ownerId'] }, { $eq: ['$venueId', '$$venueId'] }] },
    active: true,
  };
  if (q.sport) turfMatch.sports = q.sport;
  if (q.indoor !== null) turfMatch.indoor = q.indoor;

  const pipeline: PipelineStage[] = [
    q.near
      ? {
          $geoNear: {
            near: { type: 'Point', coordinates: [q.near.lng, q.near.lat] },
            spherical: true,
            distanceField: 'distanceMeters',
            ...(q.radiusKm !== null ? { maxDistance: q.radiusKm * 1000 } : {}),
            query: venueMatch,
          },
        }
      : { $match: venueMatch },
    { $lookup: { from: Owner.collection.name, localField: 'ownerId', foreignField: '_id', as: 'owner' } },
    { $match: { 'owner.status': 'active' } },
    {
      $lookup: {
        from: Turf.collection.name,
        let: { ownerId: '$ownerId', venueId: '$_id' },
        pipeline: [{ $match: turfMatch }, { $sort: { name: 1, _id: 1 } }],
        as: 'turfs',
      },
    },
    { $match: { 'turfs.0': { $exists: true } } },
    { $sort: sortStage(q) },
    { $skip: skip },
    { $limit: n },
  ];

  const rows = await Venue.aggregate<Row>(pipeline).option({ crossTenant: true });
  return rows.map(({ turfs, distanceMeters, owner: _owner, ...venue }) => ({
    venue: Venue.hydrate(venue),
    turfs: turfs.map((t) => Turf.hydrate(t)),
    distanceMeters: distanceMeters === undefined ? null : Math.round(distanceMeters),
  }));
}
