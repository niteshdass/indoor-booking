import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner, seedUser } from '../helpers/tenancy';
import { seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { RefreshToken } from '../../src/auth/refreshToken.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Booking } from '../../src/bookings/booking.model';
import { Review } from '../../src/reviews/review.model';
import { PlatformLog } from '../../src/admin/platformLog.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Booking.init(), Review.init(), PlatformLog.init(), RefreshToken.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const oid = () => new mongoose.Types.ObjectId();
let ctx: ReturnType<typeof buildTestApp>;
let admin: Awaited<ReturnType<typeof seedUser>>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let seq = 0;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    PlatformLog.deleteMany({}),
    RefreshToken.deleteMany({}),
    ...[Membership, ActivityLog, Venue, Turf, Booking, Review].map((m) => (m as typeof Venue).deleteMany({}).setOptions({ crossTenant: true })),
  ]);
  ctx = buildTestApp();
  admin = await seedUser(ctx.services, { name: 'Admin', platformAdmin: true });
  a = await seedOwner(ctx.services, { name: 'Arena' });
});

const api = (path: string) => `/api/v1${path}`;
const get = (path: string, token = admin.token) => request(ctx.app).get(api(path)).set(...bearer(token));
const post = (path: string, body: object = {}, token = admin.token) => request(ctx.app).post(api(path)).set(...bearer(token)).send(body);

async function booking(ownerId: string, venueId: string, over: Record<string, unknown> = {}) {
  seq += 1;
  const startAt = new Date(ctx.services.now().getTime() - 86_400_000);
  const endAt = new Date(startAt.getTime() + 3_600_000);
  // Pinned to the test clock: timestamps would stamp the real time.
  const doc = await Booking.create({
    ownerId, venueId, turfId: oid(), reference: `ADM${seq}`, businessDate: '2026-01-01',
    startAt, endAt, slots: [{ startAt, endAt, price: 1000 }], currency: 'BDT', subtotal: 1000, addonsTotal: 0,
    total: 1000, advanceRequired: 0, status: 'completed', paymentStatus: 'paid', source: 'online', policySnapshot: {},
    ...over,
  });
  await Booking.collection.updateOne({ _id: doc._id }, { $set: { createdAt: startAt } });
  return doc;
}

describe('platform guard', () => {
  it('refuses signed-out users, non-admins and owners', async () => {
    expect((await request(ctx.app).get(api('/admin/me'))).status).toBe(401);
    const plain = await seedUser(ctx.services);
    for (const token of [plain.token, a.token]) {
      const res = await get('/admin/me', token);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
      expect((await get('/admin/owners', token)).status).toBe(403);
    }
  });

  it('returns the role and permissions to an admin', async () => {
    const res = await get('/admin/me');
    expect(res.status).toBe(200);
    expect(res.body.role).toEqual({ key: 'super_admin', name: 'Super admin' });
    expect(res.body.permissions).toEqual(['platform.owners', 'platform.reviews', 'platform.users', 'platform.view']);
  });

  it('flags platform admins on /me', async () => {
    expect((await get('/me')).body.user.platformAdmin).toBe(true);
    expect((await get('/me', a.token)).body.user.platformAdmin).toBe(false);
  });

  it('keeps the platform role out of the owner side', async () => {
    const roles = await request(ctx.app).get(api(`/owners/${a.ownerId}/roles`)).set(...bearer(a.token));
    expect(roles.status).toBe(200);
    expect(roles.body.roles.map((r: { key: string | null }) => r.key)).not.toContain('super_admin');
    const superRole = await Role.findOne({ ownerId: null, key: 'super_admin' });
    const member = await addMember(ctx.services, a.ownerId, { roleId: String(superRole!._id) });
    // A membership pointing at the platform role is treated as no membership; it grants nothing on the owner side.
    expect((await request(ctx.app).get(api(`/owners/${a.ownerId}`)).set(...bearer(member.token))).status).toBe(404);
  });
});

describe('owner applications and approval', () => {
  it('a user applies, waits, and is approved', async () => {
    const applicant = await seedUser(ctx.services, { name: 'Rafiq' });
    const res = await post('/owners', { name: 'Smash Club', country: 'BD', currency: 'BDT', locale: 'en' }, applicant.token);
    expect(res.status).toBe(201);
    expect(res.body.owner.status).toBe('pending_approval');
    const ownerId = res.body.owner.id as string;

    // The pending owner's portal is closed.
    const portal = await request(ctx.app).get(api(`/owners/${ownerId}`)).set(...bearer(applicant.token));
    expect(portal.status).toBe(403);
    expect(portal.body.error.code).toBe('owner_inactive');

    const again = await post('/owners', { name: 'Another', country: 'BD', currency: 'BDT' }, applicant.token);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('application_pending');

    const list = await get('/admin/owners?status=pending_approval');
    expect(list.body.total).toBe(1);
    expect(list.body.owners[0]).toMatchObject({ id: ownerId, name: 'Smash Club', contact: { name: 'Rafiq' } });
    expect(list.body.counts).toEqual({ active: 1, pending_approval: 1, suspended: 0, all: 2 });

    expect((await post(`/admin/owners/${ownerId}/approve`)).body.owner.status).toBe('active');
    expect((await post(`/admin/owners/${ownerId}/approve`)).body.error.code).toBe('invalid_status');
    expect((await request(ctx.app).get(api(`/owners/${ownerId}`)).set(...bearer(applicant.token))).status).toBe(200);

    const detail = await get(`/admin/owners/${ownerId}`);
    expect(detail.body.history.map((h: { action: string }) => h.action)).toEqual(['owner.approved', 'owner.applied']);
    expect(detail.body.history[0].actor.name).toBe('Admin');
  });

  it('validates applications', async () => {
    const res = await post('/owners', { name: '', country: 'Bangladesh', currency: 'BDT' }, a.token);
    expect(res.status).toBe(400);
  });

  it('suspends with a reason and reactivates', async () => {
    expect((await post(`/admin/owners/${a.ownerId}/suspend`, {})).status).toBe(400);
    const res = await post(`/admin/owners/${a.ownerId}/suspend`, { reason: 'Fake listings' });
    expect(res.body.owner.status).toBe('suspended');
    expect((await request(ctx.app).get(api(`/owners/${a.ownerId}`)).set(...bearer(a.token))).body.error.code).toBe('owner_inactive');
    expect((await post(`/admin/owners/${a.ownerId}/approve`)).status).toBe(409);
    expect((await post(`/admin/owners/${a.ownerId}/reactivate`)).body.owner.status).toBe('active');
    const log = await get('/admin/activity');
    expect(log.body.entries.map((e: { action: string }) => e.action)).toEqual(['owner.reactivated', 'owner.suspended']);
    expect(log.body.entries[1]).toMatchObject({ target: 'Arena', reason: 'Fake listings', actor: { name: 'Admin' } });
  });

  it('404s an unknown owner', async () => {
    expect((await get(`/admin/owners/${oid()}`)).status).toBe(404);
    expect((await get('/admin/owners/nope')).status).toBe(404);
  });

  it('searches by business or contact name', async () => {
    await seedOwner(ctx.services, { name: 'Goal Zone' });
    expect((await get('/admin/owners?q=goal')).body.owners.map((o: { name: string }) => o.name)).toEqual(['Goal Zone']);
    expect((await get('/admin/owners?q=owner user')).body.total).toBe(2);
  });
});

describe('overview and owner detail', () => {
  it('counts the platform', async () => {
    const venue = await seedVenue(a.ownerId, { name: 'Alpha', slug: 'alpha' });
    await Venue.updateOne({ _id: venue._id }, { $set: { published: true } }).setOptions({ crossTenant: true });
    await booking(a.ownerId, venue.id as string);
    await booking(a.ownerId, venue.id as string, { status: 'expired' });
    await booking(a.ownerId, venue.id as string, { status: 'cancelled', amountPaid: 500, amountRefunded: 200 });
    const res = await get('/admin/overview');
    expect(res.status).toBe(200);
    expect(res.body.owners).toEqual({ active: 1, pending_approval: 0, suspended: 0 });
    expect(res.body.venues).toEqual({ total: 1, published: 1 });
    expect(res.body.bookings.recent).toBe(2);
    expect(res.body.earned).toEqual([{ currency: 'BDT', amount: 1300 }]);
    expect(res.body.newestOwners[0]).toMatchObject({ name: 'Arena', venues: 1, publishedVenues: 1, recentBookings: 2 });

    const detail = await get(`/admin/owners/${a.ownerId}`);
    expect(detail.body.venues).toEqual([expect.objectContaining({ name: 'Alpha', published: true })]);
    expect(detail.body.recent.bookings).toBe(2);
    expect(detail.body.contacts.map((c: { name: string }) => c.name)).toEqual(['Owner User']);
  });
});

describe('users', () => {
  it('lists, disables and enables accounts', async () => {
    const player = await seedUser(ctx.services, { name: 'Karim' });
    await RefreshToken.create({ userId: player.userId, tokenHash: 'h', familyId: 'f', expiresAt: new Date(Date.now() + 1e9) });
    const list = await get('/admin/users?q=karim');
    expect(list.body.users).toEqual([expect.objectContaining({ id: player.userId, status: 'active', teams: 0, platformAdmin: false })]);
    expect((await get('/admin/users?q=owner')).body.users[0].teams).toBe(1);

    expect((await post(`/admin/users/${player.userId}/disable`)).body.user.status).toBe('disabled');
    expect((await get('/me', player.token)).body.error.code).toBe('account_disabled');
    expect((await RefreshToken.findOne({ userId: player.userId }))!.revokedAt).toBeTruthy();

    expect((await post(`/admin/users/${player.userId}/enable`)).body.user.status).toBe('active');
    expect((await get('/me', player.token)).status).toBe(200);
  });

  it('cannot change an admin account', async () => {
    const other = await seedUser(ctx.services, { platformAdmin: true });
    for (const id of [admin.userId, other.userId]) {
      const res = await post(`/admin/users/${id}/disable`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('cannot_change_admin');
    }
  });
});

describe('review moderation', () => {
  async function flagged(venueId: string, stars: number) {
    const b = await booking(a.ownerId, venueId);
    const player = await seedUser(ctx.services, { name: 'Player' });
    return Review.create({
      ownerId: a.ownerId, venueId, bookingId: b._id, playerId: player.userId, stars, comment: 'meh',
      flag: { by: a.userId, at: new Date(), reason: 'Abusive' },
    });
  }

  it('hides a flagged review and recomputes the rating', async () => {
    const venue = await seedVenue(a.ownerId, { name: 'Alpha', slug: 'alpha' });
    const bad = await flagged(venue.id as string, 1);
    const good = await flagged(venue.id as string, 5);
    await Review.updateOne({ _id: good._id }, { $set: { flag: null } }).setOptions({ crossTenant: true });

    const queue = await get('/admin/reviews');
    expect(queue.body.reviews).toEqual([
      expect.objectContaining({ id: String(bad._id), state: 'flagged', flag: expect.objectContaining({ by: 'Owner User', reason: 'Abusive' }) }),
    ]);

    const res = await post(`/admin/reviews/${bad._id}/hide`);
    expect(res.status).toBe(200);
    expect(res.body.review.state).toBe('hidden');
    const v = await Venue.findById(venue._id).setOptions({ crossTenant: true });
    expect(v!.rating).toMatchObject({ average: 5, count: 1 });
    expect((await post(`/admin/reviews/${bad._id}/keep`)).body.error.code).toBe('not_flagged');
    expect((await get('/admin/reviews?state=hidden')).body.reviews).toHaveLength(1);
    expect((await get('/admin/reviews')).body.reviews).toHaveLength(0);
  });

  it('keeps a flagged review', async () => {
    const venue = await seedVenue(a.ownerId, { name: 'Alpha', slug: 'alpha' });
    const r = await flagged(venue.id as string, 2);
    const res = await post(`/admin/reviews/${r._id}/keep`);
    expect(res.body.review).toMatchObject({ state: 'kept', flag: null });
    expect((await get('/admin/reviews?state=kept')).body.reviews).toHaveLength(1);
    const log = await get('/admin/activity');
    expect(log.body.entries[0]).toMatchObject({ action: 'review.kept', target: 'Alpha' });
  });
});
