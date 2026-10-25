import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { seedVenue } from '../helpers/venues';
import { Venue } from '../../src/venues/venue.model';
import { Review } from '../../src/reviews/review.model';
import { ratingJson, recomputeVenueRating } from '../../src/reviews/rating';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([Venue.init(), Review.init()]);
});
afterAll(stopTestDb);

const oid = () => new mongoose.Types.ObjectId();
let ownerId: string;
let venueId: string;
beforeEach(async () => {
  await Review.deleteMany({}).setOptions({ crossTenant: true });
  await Venue.deleteMany({}).setOptions({ crossTenant: true });
  ownerId = oid().toString();
  venueId = (await seedVenue(ownerId)).id as string;
});

const addReview = (stars: number, moderation: 'visible' | 'hidden' = 'visible', bookingId = oid()) =>
  Review.create({ ownerId, venueId, bookingId, playerId: oid(), stars, moderation });

async function recomputeResult() {
  const session = await mongoose.startSession();
  let out: Awaited<ReturnType<typeof recomputeVenueRating>> | undefined;
  try {
    await session.withTransaction(async () => {
      out = await recomputeVenueRating(ownerId, venueId, session);
    });
  } finally {
    await session.endSession();
  }
  return out!;
}
describe('recomputeVenueRating', () => {
  it('averages visible reviews to one decimal', async () => {
    for (const s of [5, 4, 4]) await addReview(s);
    expect(await recomputeResult()).toEqual({ average: 4.3, count: 3 });
    const v = await Venue.findOne({ _id: venueId, ownerId }).lean();
    expect(v?.rating).toEqual({ average: 4.3, count: 3 });
  });

  it('ignores hidden reviews', async () => {
    for (const s of [5, 4, 4]) await addReview(s);
    await addReview(1, 'hidden');
    expect(await recomputeResult()).toEqual({ average: 4.3, count: 3 });
  });

  it('no reviews gives null average and zero count', async () => {
    expect(await recomputeResult()).toEqual({ average: null, count: 0 });
    const v = await Venue.findOne({ _id: venueId, ownerId }).lean();
    expect(v?.rating).toEqual({ average: null, count: 0 });
  });
});

describe('Review model', () => {
  it('a second review for the same booking is rejected by the unique index', async () => {
    const bookingId = oid();
    await addReview(5, 'visible', bookingId);
    await expect(addReview(4, 'visible', bookingId)).rejects.toMatchObject({ code: 11000 });
  });
});

describe('ratingJson', () => {
  it('hides empty ratings', () => {
    expect(ratingJson({ average: null, count: 0 })).toBeNull();
    expect(ratingJson(undefined)).toBeNull();
    expect(ratingJson({ average: 4.3, count: 3 })).toEqual({ average: 4.3, count: 3 });
  });
});
