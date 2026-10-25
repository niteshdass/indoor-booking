import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Booking } from '../../src/bookings/booking.model';
import { Review } from '../../src/reviews/review.model';
import { recomputeVenueRating } from '../../src/reviews/rating';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Booking.init(), Review.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const oid = () => new mongoose.Types.ObjectId();
let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let staff: Awaited<ReturnType<typeof addMember>>;
let manager: Awaited<ReturnType<typeof addMember>>;
let vA: string;
let vB: string;
let player: string;
let seq = 0;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Booking, Review].map((m) => (m as typeof Venue).deleteMany({}).setOptions({ crossTenant: true })),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
  vA = (await seedVenue(a.ownerId, { name: 'Alpha', slug: 'alpha' })).id as string;
  vB = (await seedVenue(a.ownerId, { name: 'Beta', slug: 'beta' })).id as string;
  staff = await addMember(ctx.services, a.ownerId, { roleKey: 'staff' });
  manager = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: [vA] });
  player = (await User.create({ name: 'Karim Hossain', email: 'karim@example.com' })).id as string;
});

const url = (rest: string) => `/api/v1/owners/${a.ownerId}${rest}`;
const get = (path: string, token = a.token) => request(ctx.app).get(url(path)).set(...bearer(token));
const put = (path: string, body: object, token = a.token) => request(ctx.app).put(url(path)).set(...bearer(token)).send(body);
const post = (path: string, body: object = {}, token = a.token) => request(ctx.app).post(url(path)).set(...bearer(token)).send(body);
const del = (path: string, token = a.token) => request(ctx.app).delete(url(path)).set(...bearer(token));

async function review(venueId: string, over: Record<string, unknown> = {}) {
  seq += 1;
  const bookingId = oid();
  const startAt = new Date('2026-01-01T10:00:00Z');
  const endAt = new Date('2026-01-01T11:00:00Z');
  await Booking.create({
    _id: bookingId, ownerId: a.ownerId, venueId, turfId: oid(), reference: `OWN${seq}`, businessDate: '2026-01-01',
    startAt, endAt, slots: [{ startAt, endAt, price: 1000 }], currency: 'BDT', subtotal: 1000, addonsTotal: 0,
    total: 1000, advanceRequired: 0, status: 'completed', paymentStatus: 'paid', source: 'online', policySnapshot: {},
    playerId: player,
  });
  return Review.create({ ownerId: a.ownerId, venueId, bookingId, playerId: player, stars: 5, comment: `c${seq}`, ...over });
}

describe('owner reviews', () => {
  it('owner lists reviews with filters and a per-venue summary', async () => {
    const r1 = await review(vA, { stars: 5 });
    await review(vA, { stars: 3 });
    const r3 = await review(vA, { stars: 5 });
    const rb = await review(vB, { stars: 4, moderation: 'hidden' });
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await recomputeVenueRating(a.ownerId, vA, session);
    });
    await session.endSession();

    const all = await get('/reviews');
    expect(all.status).toBe(200);
    expect(all.body.reviews).toHaveLength(4);
    expect(all.body.reviews[0]).toMatchObject({ id: rb.id, hidden: true, venueId: vB, reference: 'OWN4', reviewer: 'Karim H.' });
    expect(all.body.nextBefore).toBeNull();
    expect(all.body.summary).toEqual([
      { venueId: vA, name: 'Alpha', rating: { average: 4.3, count: 3 } },
      { venueId: vB, name: 'Beta', rating: null },
    ]);

    const five = await get('/reviews?stars=5');
    expect(five.body.reviews.map((r: { id: string }) => r.id)).toEqual([r3.id, r1.id]);
    const onlyB = await get(`/reviews?venueId=${vB}`);
    expect(onlyB.body.reviews.map((r: { id: string }) => r.id)).toEqual([rb.id]);

    const p1 = await get('/reviews?limit=3');
    expect(p1.body.reviews).toHaveLength(3);
    expect(p1.body.nextBefore).toBe(p1.body.reviews[2].id);
    const p2 = await get(`/reviews?limit=3&before=${p1.body.nextBefore}`);
    expect(p2.body.reviews.map((r: { id: string }) => r.id)).toEqual([r1.id]);
    expect(p2.body.nextBefore).toBeNull();

    expect((await get('/reviews?stars=6')).status).toBe(400);
    expect((await get('/reviews?limit=101')).status).toBe(400);
  });

  it('staff role without review.manage gets 403', async () => {
    const r = await review(vA);
    expect((await get('/reviews', staff.token)).status).toBe(403);
    expect((await put(`/reviews/${r.id}/reply`, { text: 'Hi' }, staff.token)).status).toBe(403);
    expect((await del(`/reviews/${r.id}/reply`, staff.token)).status).toBe(403);
    expect((await post(`/reviews/${r.id}/flag`, {}, staff.token)).status).toBe(403);
  });

  it('a manager scoped to venue A cannot see or act on venue B', async () => {
    const ra = await review(vA);
    const rb = await review(vB);
    const list = await get('/reviews', manager.token);
    expect(list.status).toBe(200);
    expect(list.body.reviews.map((r: { id: string }) => r.id)).toEqual([ra.id]);
    expect(list.body.summary.map((s: { venueId: string }) => s.venueId)).toEqual([vA]);
    const b = await get(`/reviews?venueId=${vB}`, manager.token);
    expect(b.status).toBe(404);
    expect(b.body.error?.code ?? b.body.code).toBe('not_found');
    expect((await put(`/reviews/${rb.id}/reply`, { text: 'Hi' }, manager.token)).status).toBe(404);
    expect((await del(`/reviews/${rb.id}/reply`, manager.token)).status).toBe(404);
    expect((await post(`/reviews/${rb.id}/flag`, {}, manager.token)).status).toBe(404);
    expect((await put(`/reviews/${ra.id}/reply`, { text: 'Hi' }, manager.token)).status).toBe(200);
  });

  it('reply create, edit, delete', async () => {
    const r = await review(vA);
    const first = await put(`/reviews/${r.id}/reply`, { text: '  Thanks!  ' });
    expect(first.status).toBe(200);
    expect(first.body.review.reply).toMatchObject({ text: 'Thanks!', editedAt: null });
    const at = first.body.review.reply.at;
    ctx.services.clock.advance(60_000);
    const second = await put(`/reviews/${r.id}/reply`, { text: 'Thanks again' });
    expect(second.body.review.reply.text).toBe('Thanks again');
    expect(second.body.review.reply.at).toBe(at);
    expect(second.body.review.reply.editedAt).not.toBeNull();
    expect((await del(`/reviews/${r.id}/reply`)).status).toBe(204);
    expect((await Review.findOne({ _id: r.id }).setOptions({ crossTenant: true }))!.reply).toBeNull();
    expect((await put(`/reviews/${r.id}/reply`, { text: 'x'.repeat(1001) })).status).toBe(400);
    expect((await put(`/reviews/${r.id}/reply`, { text: '   ' })).status).toBe(400);
    const actions = (await ActivityLog.find({ action: /^review\./ }).setOptions({ crossTenant: true }).sort({ _id: 1 })).map((l) => l.action);
    expect(actions).toEqual(['review.replied', 'review.replied', 'review.reply_deleted']);
  });

  it('lists 20 per page by default', async () => {
    for (let i = 0; i < 21; i++) await review(vA);
    const res = await get('/reviews');
    expect(res.body.reviews).toHaveLength(20);
    expect(res.body.nextBefore).toBe(res.body.reviews[19].id);
  });

  it('deleting a missing reply is a quiet 204', async () => {
    const r = await review(vA);
    expect((await del(`/reviews/${r.id}/reply`)).status).toBe(204);
    expect(await ActivityLog.countDocuments({ action: /^review\./ }).setOptions({ crossTenant: true })).toBe(0);
  });

  it('cannot reply to a hidden review', async () => {
    const r = await review(vA, { moderation: 'hidden' });
    const res = await put(`/reviews/${r.id}/reply`, { text: 'Hi' });
    expect(res.status).toBe(409);
    expect(res.body.error?.code ?? res.body.code).toBe('cannot_reply');
  });

  it('flag is idempotent and leaves the review public', async () => {
    const r = await review(vA);
    const first = await post(`/reviews/${r.id}/flag`, { reason: ' spam ' });
    expect(first.status).toBe(200);
    expect(first.body.review.flag).toMatchObject({ reason: 'spam' });
    ctx.services.clock.advance(60_000);
    const second = await post(`/reviews/${r.id}/flag`, { reason: 'other' });
    expect(second.status).toBe(200);
    expect(second.body.review.flag).toEqual(first.body.review.flag);
    const row = await Review.findOne({ _id: r.id }).setOptions({ crossTenant: true });
    expect(row!.moderation).toBe('visible');
    expect(await ActivityLog.countDocuments({ action: 'review.flagged' }).setOptions({ crossTenant: true })).toBe(1);
  });

  it('flagged review stays on the public list', async () => {
    await Venue.updateOne({ _id: vA, ownerId: a.ownerId }, { published: true });
    const r = await review(vA);
    await post(`/reviews/${r.id}/flag`);
    const pub = await request(ctx.app).get('/api/v1/venues/alpha/reviews');
    expect(pub.body.reviews.map((x: { id: string }) => x.id)).toEqual([r.id]);
  });

  it('cannot flag a kept review or a hidden one', async () => {
    const kept = await review(vA, { flagCleared: true });
    const res = await post(`/reviews/${kept.id}/flag`);
    expect(res.status).toBe(409);
    expect(res.body.error?.code ?? res.body.code).toBe('cannot_flag');
    const listed = await get(`/reviews?venueId=${vA}`);
    expect(listed.body.reviews.find((x: { id: string }) => x.id === kept.id).flagCleared).toBe(true);
    const hidden = await review(vA, { moderation: 'hidden' });
    expect((await post(`/reviews/${hidden.id}/flag`)).status).toBe(409);
  });

  it('owner endpoints cannot change stars or delete a review', async () => {
    const r = await review(vA);
    const patch = await request(ctx.app).patch(url(`/reviews/${r.id}`)).set(...bearer(a.token)).send({ stars: 1 });
    expect(patch.status).toBe(404);
    expect((await del(`/reviews/${r.id}`)).status).toBe(404);
    expect(await Review.countDocuments({ _id: r._id }).setOptions({ crossTenant: true })).toBe(1);
  });
});
