import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { seedOwner } from '../helpers/tenancy';
import { seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Review } from '../../src/reviews/review.model';
import { recomputeVenueRating } from '../../src/reviews/rating';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init(), Turf.init(), Review.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const oid = () => new mongoose.Types.ObjectId();
let ctx: ReturnType<typeof buildTestApp>;
let ownerId: string;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    Venue.deleteMany({}).setOptions({ crossTenant: true }),
    Review.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp();
  ownerId = (await seedOwner(ctx.services)).ownerId;
});

const list = (slug: string, q: Record<string, string> = {}) =>
  request(ctx.app).get(`/api/v1/venues/${slug}/reviews`).query(q);

describe('GET /venues/:slug/reviews', () => {
  it('lists visible reviews newest first in pages of 10 with replies', async () => {
    const venue = await seedVenue(ownerId, { slug: 'rev-venue', published: true });
    const venueId = venue.id as string;
    const player = await User.create({ name: 'Karim Hossain', email: 'karim@example.com' });
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await Review.create({
        ownerId, venueId, bookingId: oid(), playerId: player.id, stars: (i % 5) + 1,
        comment: `c${i}`, moderation: i === 5 ? 'hidden' : 'visible',
        ...(i === 11 ? { reply: { text: 'Thanks!', by: oid(), at: new Date('2026-01-02T00:00:00Z'), editedAt: null } } : {}),
      });
      if (i !== 5) ids.push(r.id as string);
    }
    ids.reverse(); // newest first
    const p1 = await list('rev-venue');
    expect(p1.status).toBe(200);
    expect(p1.body.reviews.map((r: { id: string }) => r.id)).toEqual(ids.slice(0, 10));
    expect(p1.body.nextBefore).toBe(ids[9]);
    expect(p1.body.reviews[0].reply).toEqual({ text: 'Thanks!', at: '2026-01-02T00:00:00.000Z', editedAt: null });
    expect(p1.body.reviews[0].reviewer).toBe('Karim H.');
    expect(JSON.stringify(p1.body)).not.toMatch(/karim@example|playerId|bookingId|phone|email/);
    const p2 = await list('rev-venue', { before: p1.body.nextBefore });
    expect(p2.body.reviews.map((r: { id: string }) => r.id)).toEqual(ids.slice(10));
    expect(p2.body.nextBefore).toBeNull();
    const all = [...p1.body.reviews, ...p2.body.reviews].map((r: { comment: string }) => r.comment);
    expect(all).not.toContain('c5');
  });

  it('honours limit and rejects bad paging params', async () => {
    const venue = await seedVenue(ownerId, { slug: 'rev-lim', published: true });
    for (let i = 0; i < 3; i++) await Review.create({ ownerId, venueId: venue.id, bookingId: oid(), playerId: oid(), stars: 5 });
    const res = await list('rev-lim', { limit: '2' });
    expect(res.body.reviews).toHaveLength(2);
    expect(res.body.nextBefore).not.toBeNull();
    expect((await list('rev-lim', { limit: '0' })).status).toBe(400);
    expect((await list('rev-lim', { limit: '51' })).status).toBe(400);
    expect((await list('rev-lim', { before: 'nope' })).status).toBe(400);
  });

  it('unpublished venue reviews 404', async () => {
    await seedVenue(ownerId, { slug: 'draft-venue', published: false });
    expect((await list('draft-venue')).status).toBe(404);
    expect((await list('no-such')).status).toBe(404);
  });
});

describe('venue page rating', () => {
  it('venue page carries rating, null without reviews', async () => {
    const venue = await seedVenue(ownerId, { slug: 'rated', published: true });
    const get = () => request(ctx.app).get('/api/v1/venues/rated');
    expect((await get()).body.venue.rating).toBeNull();
    const venueId = venue.id as string;
    for (const stars of [5, 4]) await Review.create({ ownerId, venueId, bookingId: oid(), playerId: oid(), stars });
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(() => recomputeVenueRating(ownerId, venueId, session));
    } finally {
      await session.endSession();
    }
    expect((await get()).body.venue.rating).toEqual({ average: 4.5, count: 2 });
  });
});
