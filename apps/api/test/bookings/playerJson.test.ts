import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { signAccessToken } from '../../src/auth/jwt';
import { seedOwner, bearer } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Booking } from '../../src/bookings/booking.model';
import { SlotLock } from '../../src/bookings/slotLock.model';
import mongoose from 'mongoose';
import { playerBookingsJson } from '../../src/bookings/playerJson';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init(), Turf.init(), Booking.init(), SlotLock.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const TZ = 'Asia/Dhaka';
const D = '2026-01-10';
const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '23:00' }]),
);
const at = (hm: string) => localToUtc(D, hmToMin(hm), TZ).toISOString();
const PHONE = '+8801711111111';

let ctx: ReturnType<typeof buildTestApp>;
let ownerId: string;
let slug: string;
let turfId: string;
let token: string;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[Venue, Turf, Booking, SlotLock].map((m) => (m as typeof Venue).deleteMany({}).setOptions({ crossTenant: true })),
  ]);
  ctx = buildTestApp();
  ({ ownerId } = await seedOwner(ctx.services));
  const venue = await seedVenue(ownerId, {
    name: 'Arena', published: true, slug: `arena-${Math.random().toString(36).slice(2, 8)}`, timezone: TZ,
    settings: { hours: HOURS, bookingWindowDays: 365, guestBooking: { allowed: true, requireOtp: false } },
  });
  const turf = await seedTurf(ownerId, venue.id as string, { name: 'Court 2', pricing: { base: 1500, rules: [] } });
  slug = venue.slug;
  turfId = turf.id as string;
  const u = await User.create({ name: 'Player', email: `p${Math.random()}@test.local` });
  token = await signAccessToken(u.id as string, ctx.config.jwtSecret, ctx.services.now());
});

const book = () =>
  request(ctx.app).post(`/api/v1/venues/${slug}/turfs/${turfId}/bookings`).set(...bearer(token)).send({ date: D, startAts: [at('18:00')] });

describe('player booking JSON', () => {
  it('lists with venue and turf', async () => {
    await book();
    const res = await request(ctx.app).get('/api/v1/me/bookings').set(...bearer(token));
    expect(res.body.bookings[0]).toMatchObject({
      venue: { slug, name: 'Arena', timezone: TZ, address: 'Road 1', city: 'Dhaka' },
      turf: { name: 'Court 2' },
    });
  });

  it('single booking, create and guest lookup carry them', async () => {
    const created = await book();
    expect(created.body.booking.venue.name).toBe('Arena');
    const one = await request(ctx.app).get(`/api/v1/me/bookings/${created.body.booking.id}`).set(...bearer(token));
    expect(one.body.booking.venue.name).toBe('Arena');

    const g = await request(ctx.app)
      .post(`/api/v1/venues/${slug}/turfs/${turfId}/bookings`)
      .send({ date: D, startAts: [at('19:00')], guest: { name: 'Guest', phone: PHONE } });
    expect(g.status).toBe(201);
    expect(g.body.booking.turf.name).toBe('Court 2');
    const look = await request(ctx.app).post('/api/v1/bookings/lookup').send({ reference: g.body.booking.reference, phone: PHONE });
    expect(look.body.booking.turf.name).toBe('Court 2');
  });

  it('runs no query for an empty list', async () => {
    const spy = vi.spyOn(Venue, 'find');
    expect(await playerBookingsJson([], new Date())).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('yields turf null when the turf was deleted, venue stays', async () => {
    await book();
    await Turf.deleteOne({ _id: turfId }).setOptions({ crossTenant: true });
    const res = await request(ctx.app).get('/api/v1/me/bookings').set(...bearer(token));
    expect(res.body.bookings[0].turf).toBeNull();
    expect(res.body.bookings[0].venue.name).toBe('Arena');
  });
  describe('GET /me/bookings window', () => {
    const DAY = 86_400_000;
    const insert = async (startAt: Date, over: Record<string, unknown> = {}) => {
      const user = (await User.findOne({ name: 'Player' }))!;
      const turf = (await Turf.findOne({ _id: turfId }).setOptions({ crossTenant: true }))!;
      const [b] = await Booking.insertMany([{
        ownerId: ownerId, venueId: turf.venueId, turfId, reference: `R${Math.random().toString(36).slice(2, 10)}`,
        businessDate: startAt.toISOString().slice(0, 10), startAt, endAt: new Date(startAt.getTime() + 3_600_000),
        slots: [{ startAt, endAt: new Date(startAt.getTime() + 3_600_000), price: 1500 }],
        currency: 'BDT', subtotal: 1500, addonsTotal: 0, total: 1500, advanceRequired: 0,
        status: 'confirmed', paymentStatus: 'unpaid', source: 'online', playerId: user._id,
        policySnapshot: { paymentPolicy: null, refundRules: [] }, ...over,
      }]);
      return b!;
    };
    const ids = async () =>
      (await request(ctx.app).get('/api/v1/me/bookings').set(...bearer(token))).body.bookings.map((b: { id: string }) => b.id);

    it("a declined series' rejected games are not listed", async () => {
      const now = ctx.services.now();
      const seriesId = new mongoose.Types.ObjectId();
      const single = await insert(new Date(now.getTime() + DAY));
      const rejected = await insert(new Date(now.getTime() + 7 * DAY), { seriesId, status: 'rejected' });
      const got = await ids();
      expect(got).toContain(String(single._id));
      expect(got).not.toContain(String(rejected._id));
    });

    it("a 100+ game series does not hide tomorrow's single booking or yesterday's booking", async () => {
      const now = ctx.services.now();
      const seriesId = new mongoose.Types.ObjectId();
      for (let i = 0; i < 101; i++) await insert(new Date(now.getTime() + (10 + i) * DAY), { seriesId });
      const tomorrow = await insert(new Date(now.getTime() + DAY));
      const yesterday = await insert(new Date(now.getTime() - DAY));
      const got = await ids();
      expect(got).toContain(String(tomorrow._id));
      expect(got).toContain(String(yesterday._id));
    });
  });
});
