import type { PipelineStage } from 'mongoose';
import { Owner } from '../tenancy/owner.model';
import { Venue, type VenueDoc } from '../venues/venue.model';
import { Turf, type TurfDoc } from '../venues/turf.model';
import type { Bbox, SearchQuery } from './query';

export type Candidate = { venue: VenueDoc; turfs: TurfDoc[]; distanceMeters: number | null };

type Row = Record<string, unknown> & { turfs: Record<string, unknown>[]; distanceMeters?: number };

/** Widest strip one polygon covers: GeoJSON polygons must stay well inside a hemisphere. */
const STRIP_DEG = 90;
/** Vertex spacing along the north and south edges, which are parallels, not great circles. */
const EDGE_STEP_DEG = 1;
/** Outward slack so the great-circle bulge between vertices never cuts off the box; the exact match trims it. */
const PAD_DEG = 0.01;
const POLE = 89.99;

function strip(west: number, east: number, south: number, north: number): Record<string, unknown> {
  const s = Math.max(-POLE, south - PAD_DEG);
  const n = Math.min(POLE, north + PAD_DEG);
  const steps = Math.max(1, Math.ceil((east - west) / EDGE_STEP_DEG));
  const lngs = Array.from({ length: steps + 1 }, (_, i) => west + ((east - west) * i) / steps);
  const ring = [...lngs.map((x) => [x, s]), ...[...lngs].reverse().map((x) => [x, n]), [west, s]];
  return { location: { $geoWithin: { $geometry: { type: 'Polygon', coordinates: [ring] } } } };
}

/**
 * The map box as 2dsphere-indexable $geoWithin polygons (split at the antimeridian and into
 * strips of at most STRIP_DEG), plus the exact coordinate ranges the polygons approximate.
 */
export function bboxFilter({ west, south, east, north }: Bbox): Record<string, unknown> {
  const spans: [number, number][] = west < east ? [[west, east]] : [[west, 180], [-180, east]];
  const strips = spans.flatMap(([w, e]) => {
    const count = Math.ceil((e - w) / STRIP_DEG);
    return Array.from({ length: count }, (_, i) => strip(w + ((e - w) * i) / count, w + ((e - w) * (i + 1)) / count, south, north));
  });
  const lng = 'location.coordinates.0';
  const exactLng = west < east ? { [lng]: { $gte: west, $lte: east } } : { $or: [{ [lng]: { $gte: west } }, { [lng]: { $lte: east } }] };
  return {
    $and: [
      strips.length === 1 ? strips[0]! : { $or: strips },
      { 'location.coordinates.1': { $gte: south, $lte: north } },
      exactLng,
    ],
  };
}

/** Just the coordinate ranges of the box, for $geoNear, which already reads the 2dsphere index. */
function exactBox(b: Bbox): Record<string, unknown> {
  return { $and: (bboxFilter(b).$and as Record<string, unknown>[]).slice(1) };
}

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
  // With a centre point $geoNear already walks the 2dsphere index, so the box only has to trim.
  if (q.bbox) Object.assign(venueMatch, q.near ? exactBox(q.bbox) : bboxFilter(q.bbox));

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
