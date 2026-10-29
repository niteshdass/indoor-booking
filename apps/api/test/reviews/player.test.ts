import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { bearer, seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { signAccessToken } from '../../src/auth/jwt';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Booking, type BookingDoc } from '../../src/bookings/booking.model';
import { Notification } from '../../src/notifications/notification.model';
import { Review } from '../../src/reviews/review.model';

const cross = { crossTenant: true };
const DAY = 86_400_000;
const HOUR = 3_600_000;

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Booking.init(), Notification.init(), Review.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let ownerId: string;
let venueId: string;
let turfId: string;
let playerId: string;
let token: string;
let seq = 0;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Booking, Notification, Review].map((m) => (m as typeof Venue).deleteMany({}).setOptions(cross)),
  ]);
  ctx = buildTestApp();
  ({ ownerId } = await seedOwner(ctx.services));
  venueId = (await seedVenue(ownerId)).id as string;
  turfId = (await seedTurf(ownerId, venueId)).id as string;
  const u = await User.create({ name: 'Karim Hossain', email: `karim${Math.random()}@test.local` });
  playerId = u.id as string;
  token = await signAccessToken(playerId, ctx.config.jwtSecret, ctx.services.now());
});

/** A booking that finished an hour ago (the clock does not move unless a test moves it). */
async function seedBooking(over: Record<string, unknown> = {}): Promise<BookingDoc> {
  seq += 1;
  const now = ctx.services.now().getTime();
  const startAt = new Date(now - 3 * HOUR);
  const endAt = new Date(now - 2 * HOUR);
  return Booking.create({
    ownerId, venueId, turfId,
    reference: `REV${seq}`,
    businessDate: '2025-12-31',
    startAt, endAt,
    slots: [{ startAt, endAt, price: 5000 }],
    currency: 'BDT', subtotal: 5000, addonsTotal: 0, total: 5000, advanceRequired: 0,
    status: 'completed', paymentStatus: 'paid', source: 'online', policySnapshot: {},
    playerId,
    completedAt: new Date(now - HOUR),
    ...over,
  });
}

const url = (b: BookingDoc | string) => `/api/v1/me/bookings/${typeof b === 'string' ? b : String(b._id)}/review`;
const post = (b: BookingDoc | string, body: object = { stars: 4, comment: 'Good lights' }, t = token) =>
  request(ctx.app).post(url(b)).set(...bearer(t)).send(body);
const patch = (b: BookingDoc, body: object) => request(ctx.app).patch(url(b)).set(...bearer(token)).send(body);
const del = (b: BookingDoc) => request(ctx.app).delete(url(b)).set(...bearer(token));
const venueRating = async () => (await Venue.findOne({ ownerId, _id: venueId }).lean())?.rating;
const postedRows = () => Notification.countDocuments({ event: 'review_posted' }).setOptions(cross);
/** Moves the clock by `ms`; the access token is re-signed so it has not expired. */
async function advance(ms: number) {
  ctx.services.clock.advance(ms);
  token = await signAccessToken(playerId, ctx.config.jwtSecret, ctx.services.now());
}
/** Moves the clock to exactly `to`. */
const setClock = (to: Date) => advance(to.getTime() - ctx.services.now().getTime());

describe('POST /me/bookings/:id/review', () => {
  it('posts a review and updates the venue rating', async () => {
    const b = await seedBooking();
    const res = await post(b);
    expect(res.status).toBe(201);
    expect(res.body.review).toMatchObject({ stars: 4, comment: 'Good lights', reviewer: 'Karim H.', edited: false, reply: null, hidden: false });
    expect(res.body.review.editableUntil).toBe(new Date(ctx.services.now().getTime() + 30 * DAY).toISOString());
    expect(await venueRating()).toEqual({ average: 4, count: 1 });
    expect(await postedRows()).toBeGreaterThanOrEqual(1);
    const booking = await Booking.findOne({ ownerId, _id: b._id });
    expect(booking!.reviewedAt).toEqual(ctx.services.now());
    const log = await ActivityLog.findOne({ ownerId, action: 'review.posted' });
    expect(String(log!.actorId)).toBe(playerId);
  });

  it("rejects a booking that is not completed, a guest booking and another player's booking", async () => {
    const confirmed = await seedBooking({ status: 'confirmed', completedAt: null });
    expect((await post(confirmed)).body.error.code).toBe('not_reviewable');
    expect((await post(confirmed)).status).toBe(409);

    const guest = await seedBooking({ playerId: null, guest: { name: 'Gus', phone: '+8801811111111' } });
    expect((await post(guest)).status).toBe(404);

    const other = await User.create({ name: 'Other', email: `o${Math.random()}@test.local` });
    const theirs = await seedBooking({ playerId: other._id });
    const res = await post(theirs);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');

    expect((await post('not-an-id')).status).toBe(404);
    expect((await request(ctx.app).post(url(theirs)).send({ stars: 4 })).status).toBe(401);
  });

  it('window edges', async () => {
    const b = await seedBooking();
    await setClock(new Date(b.completedAt!.getTime() + 30 * DAY));
    expect((await post(b)).status).toBe(201);

    const late = await seedBooking({ completedAt: new Date(ctx.services.now().getTime() - 30 * DAY - 1) });
    const res = await post(late);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('not_reviewable');
  });

  it('two posts at once make one review', async () => {
    for (let i = 0; i < 5; i++) {
      const b = await seedBooking();
      const [a, c] = await Promise.all([post(b, { stars: 5 }), post(b, { stars: 3 })]);
      expect([a.status, c.status].sort()).toEqual([201, 409]);
      const loser = a.status === 409 ? a : c;
      expect(loser.body.error.code).toBe('already_reviewed');
      expect(await Review.countDocuments({ bookingId: b._id }).setOptions(cross)).toBe(1);
    }
    expect(await Review.countDocuments({}).setOptions(cross)).toBe(5);
    expect((await venueRating())!.count).toBe(5);
  });

  it('a write conflict that outlives the retries is already_reviewed only when the booking is reviewed', async () => {
    const conflict = () => Object.assign(new Error('WriteConflict'), { code: 112 });
    const spy = vi.spyOn(Booking, 'findOneAndUpdate').mockImplementation(() => {
      throw conflict();
    });
    try {
      const b = await seedBooking();
      const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect((await post(b)).status).toBe(500);
      silence.mockRestore();

      const won = await seedBooking({ reviewedAt: ctx.services.now() });
      const res = await post(won);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('already_reviewed');
    } finally {
      spy.mockRestore();
    }
  });

  it('a duplicate review row maps to already_reviewed', async () => {
    const b = await seedBooking();
    await Review.create({ ownerId, venueId, bookingId: b._id, playerId, stars: 3 });
    const res = await post(b);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_reviewed');
    expect((await Booking.findOne({ ownerId, _id: b._id }))!.reviewedAt).toBeNull();
  });

  it('comment rules', async () => {
    const blank = await post(await seedBooking(), { stars: 4, comment: '   ' });
    expect(blank.status).toBe(201);
    expect(blank.body.review.comment).toBeNull();
    expect((await Review.findById(blank.body.review.id).setOptions(cross))!.comment).toBeNull();

    const long = await post(await seedBooking(), { stars: 4, comment: 'a'.repeat(1001) });
    expect(long.status).toBe(400);
    expect(long.body.error.code).toBe('validation_error');

    expect((await post(await seedBooking(), { stars: 4, comment: 'ж'.repeat(1000) })).status).toBe(201);

    const b = await seedBooking();
    for (const stars of [0, 6, 4.5]) expect((await post(b, { stars })).status).toBe(400);
    expect((await post(b, { stars: 4, extra: 1 })).status).toBe(400);
    expect((await post(b, {})).status).toBe(400);
  });
});

describe('PATCH and DELETE /me/bookings/:id/review', () => {
  it('edit keeps createdAt, sets edited and keeps the reply', async () => {
    const b = await seedBooking();
    const created = (await post(b)).body.review;
    await Review.updateOne(
      { ownerId, _id: created.id },
      { $set: { reply: { text: 'Thanks!', by: new mongoose.Types.ObjectId(), at: ctx.services.now(), editedAt: null } } },
    );
    await advance(DAY);
    const res = await patch(b, { stars: 2 });
    expect(res.status).toBe(200);
    expect(res.body.review).toMatchObject({ stars: 2, comment: 'Good lights', edited: true, createdAt: created.createdAt });
    expect(res.body.review.reply).toMatchObject({ text: 'Thanks!', editedAt: null });
    expect(await venueRating()).toEqual({ average: 2, count: 1 });
    expect(await postedRows()).toBe(1);

    const cleared = await patch(b, { comment: '' });
    expect(cleared.body.review).toMatchObject({ stars: 2, comment: null });
    expect((await patch(b, {})).status).toBe(400);
  });

  it('edit and delete lock after 30 days', async () => {
    const b = await seedBooking();
    const created = (await post(b)).body.review;
    await setClock(new Date(Date.parse(created.createdAt) + 30 * DAY));
    expect((await patch(b, { stars: 5 })).status).toBe(200);
    await advance(1);
    const late = await patch(b, { stars: 3 });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('review_locked');
    const lateDelete = await del(b);
    expect(lateDelete.status).toBe(409);
    expect(lateDelete.body.error.code).toBe('review_locked');
  });

  it('hidden review is locked and shown hidden to its author', async () => {
    const b = await seedBooking();
    const created = (await post(b)).body.review;
    await Review.updateOne({ ownerId, _id: created.id }, { $set: { moderation: 'hidden' } });
    const res = await patch(b, { stars: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('review_locked');
    expect((await del(b)).status).toBe(409);

    const one = await request(ctx.app).get(`/api/v1/me/bookings/${String(b._id)}`).set(...bearer(token));
    expect(one.body.booking.review).toMatchObject({ id: created.id, hidden: true, editableUntil: null });
  });

  it("another player's review is not found", async () => {
    const b = await seedBooking();
    await post(b);
    const other = await User.create({ name: 'Other', email: `o${Math.random()}@test.local` });
    const t = await signAccessToken(other.id as string, ctx.config.jwtSecret, ctx.services.now());
    expect((await request(ctx.app).patch(url(b)).set(...bearer(t)).send({ stars: 1 })).status).toBe(404);
    expect((await request(ctx.app).delete(url(b)).set(...bearer(t))).status).toBe(404);
    expect((await patch(await seedBooking(), { stars: 1 })).status).toBe(404);
  });

  it('delete removes the review and the booking cannot be reviewed again', async () => {
    const b = await seedBooking();
    await post(b);
    const res = await del(b);
    expect(res.status).toBe(204);
    expect(await Review.countDocuments({}).setOptions(cross)).toBe(0);
    expect(await venueRating()).toEqual({ average: null, count: 0 });
    expect((await Booking.findOne({ ownerId, _id: b._id }))!.reviewedAt).not.toBeNull();
    const again = await post(b);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_reviewed');
  });
});

describe('player bookings carry review data', () => {
  it('my bookings carry reviewableUntil and my review', async () => {
    const b = await seedBooking();
    const list = () => request(ctx.app).get('/api/v1/me/bookings').set(...bearer(token));
    const before = (await list()).body.bookings[0];
    expect(before.reviewableUntil).toBe(new Date(b.completedAt!.getTime() + 30 * DAY).toISOString());
    expect(before.review).toBeNull();

    const posted = (await post(b)).body.review;
    const after = (await list()).body.bookings[0];
    expect(after.reviewableUntil).toBeNull();
    expect(after.review).toMatchObject({ id: posted.id, stars: 4, reviewer: 'Karim H.' });
  });

  it('reviewableUntil is null when the window has passed or the booking is not completed', async () => {
    const b = await seedBooking({ completedAt: new Date(ctx.services.now().getTime() - 30 * DAY - 1) });
    const c = await seedBooking({ status: 'confirmed', completedAt: null });
    const res = await request(ctx.app).get('/api/v1/me/bookings').set(...bearer(token));
    const byId = new Map(res.body.bookings.map((x: { id: string }) => [x.id, x]));
    expect(byId.get(String(b._id))).toMatchObject({ reviewableUntil: null, review: null });
    expect(byId.get(String(c._id))).toMatchObject({ reviewableUntil: null, review: null });
  });
});

describe('guest lookup of a player-linked walk-in', () => {
  it('never returns the review or the review window', async () => {
    const phone = '+8801822222222';
    const b = await seedBooking({ source: 'walkin', guest: { name: 'Karim', phone } });
    expect((await post(b)).status).toBe(201);
    const look = await request(ctx.app).post('/api/v1/bookings/lookup').send({ reference: b.reference, phone });
    expect(look.status).toBe(200);
    expect(look.body.booking).toMatchObject({ review: null, reviewableUntil: null });
    // The player still sees it on their own bookings.
    const own = await request(ctx.app).get('/api/v1/me/bookings').set(...bearer(token));
    const mine = own.body.bookings.find((x: { id: string }) => x.id === String(b._id));
    expect(mine.review).toMatchObject({ stars: 4 });
  });
});
