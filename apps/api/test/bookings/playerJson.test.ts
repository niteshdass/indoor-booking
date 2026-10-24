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
    const look = await request(ctx.app).get('/api/v1/bookings/lookup').query({ reference: g.body.booking.reference, phone: PHONE });
    expect(look.body.booking.turf.name).toBe('Court 2');
  });

  it('runs no query for an empty list', async () => {
    const spy = vi.spyOn(Venue, 'find');
    expect(await playerBookingsJson([])).toEqual([]);
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
});
