import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { MAX_SAVED_VENUES } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { bearer, seedOwner, seedUser } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { SavedVenue } from '../../src/venues/savedVenue.model';

const cross = { crossTenant: true };

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(), SavedVenue.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let player: { userId: string; token: string };

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }), SavedVenue.deleteMany({}),
    ...[ActivityLog, Venue, Turf].map((m) => (m as typeof Venue).deleteMany({}).setOptions(cross)),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
  player = await seedUser(ctx.services, { name: 'Karim Hossain' });
});

const api = () => request(ctx.app);
const path = (slug = '') => `/api/v1/me/saved-venues${slug ? `/${slug}` : ''}`;

describe('saved venues', () => {
  it('needs a signed-in player', async () => {
    await seedVenue(owner.ownerId, { slug: 'arena-one', published: true });
    expect((await api().get(path())).status).toBe(401);
    expect((await api().put(path('arena-one'))).status).toBe(401);
    expect((await api().delete(path('arena-one'))).status).toBe(401);
  });

  it('save, see it saved and listed newest first, save again, then remove', async () => {
    const one = await seedVenue(owner.ownerId, { slug: 'arena-one', name: 'Arena One', published: true });
    await seedTurf(owner.ownerId, one.id as string, { sports: ['futsal', 'cricket'] });
    await seedTurf(owner.ownerId, one.id as string, { sports: ['football'] });
    await seedTurf(owner.ownerId, one.id as string, { sports: ['tennis'], active: false });
    await Venue.updateOne({ _id: one._id }, { photos: [{ url: 'http://x/1.jpg', alt: 'Pitch' }], rating: { average: 4.5, count: 2 } }).setOptions(cross);
    await seedVenue(owner.ownerId, { slug: 'arena-two', name: 'Arena Two', published: true });

    expect((await api().get(path('arena-one')).set(...bearer(player.token))).body).toEqual({ saved: false });
    expect((await api().put(path('arena-one')).set(...bearer(player.token))).body).toEqual({ saved: true });
    expect((await api().put(path('arena-two')).set(...bearer(player.token))).body).toEqual({ saved: true });
    expect((await api().put(path('arena-one')).set(...bearer(player.token))).status).toBe(200);
    expect(await SavedVenue.countDocuments({ userId: player.userId })).toBe(2);
    expect((await api().get(path('arena-one')).set(...bearer(player.token))).body).toEqual({ saved: true });

    const list = await api().get(path()).set(...bearer(player.token));
    expect(list.status).toBe(200);
    expect(list.body.venues.map((v: { slug: string }) => v.slug)).toEqual(['arena-two', 'arena-one']);
    const saved = list.body.venues[1];
    expect(saved).toMatchObject({
      slug: 'arena-one',
      name: 'Arena One',
      address: 'Road 1',
      city: 'Dhaka',
      photo: { url: 'http://x/1.jpg', alt: 'Pitch' },
      rating: { average: 4.5, count: 2 },
    });
    // Catalog order, active turfs only.
    expect(saved.sports).toEqual(['football', 'futsal', 'cricket']);
    expect(Date.parse(saved.savedAt)).not.toBeNaN();
    expect(list.body.venues[0]).toMatchObject({ photo: null, rating: null, sports: [] });

    expect((await api().delete(path('arena-one')).set(...bearer(player.token))).status).toBe(204);
    expect((await api().delete(path('arena-one')).set(...bearer(player.token))).status).toBe(204);
    expect((await api().get(path('arena-one')).set(...bearer(player.token))).body).toEqual({ saved: false });
  });

  it("only the player's own saves", async () => {
    await seedVenue(owner.ownerId, { slug: 'arena-one', published: true });
    await api().put(path('arena-one')).set(...bearer(player.token));
    const other = await seedUser(ctx.services, { name: 'Other' });
    expect((await api().get(path()).set(...bearer(other.token))).body).toEqual({ venues: [] });
    expect((await api().get(path('arena-one')).set(...bearer(other.token))).body).toEqual({ saved: false });
    await api().delete(path('arena-one')).set(...bearer(other.token));
    expect(await SavedVenue.countDocuments({ userId: player.userId })).toBe(1);
  });

  it('unpublished, unknown and malformed venues cannot be saved or looked up', async () => {
    await seedVenue(owner.ownerId, { slug: 'hidden', published: false });
    for (const slug of ['hidden', 'nope', 'Bad_Slug']) {
      expect((await api().put(path(slug)).set(...bearer(player.token))).status).toBe(404);
      expect((await api().get(path(slug)).set(...bearer(player.token))).status).toBe(404);
    }
    expect((await api().delete(path('Bad_Slug')).set(...bearer(player.token))).status).toBe(204);
  });

  it('a venue unpublished or of a suspended owner leaves the list, comes back, and can still be removed', async () => {
    const one = await seedVenue(owner.ownerId, { slug: 'arena-one', published: true });
    const other = await seedOwner(ctx.services, { name: 'Other' });
    await seedVenue(other.ownerId, { slug: 'arena-two', published: true });
    await api().put(path('arena-one')).set(...bearer(player.token));
    await api().put(path('arena-two')).set(...bearer(player.token));

    await Venue.updateOne({ _id: one._id }, { published: false }).setOptions(cross);
    await Owner.updateOne({ _id: other.ownerId }, { status: 'suspended' });
    expect((await api().get(path()).set(...bearer(player.token))).body).toEqual({ venues: [] });

    await Owner.updateOne({ _id: other.ownerId }, { status: 'active' });
    const back = await api().get(path()).set(...bearer(player.token));
    expect(back.body.venues.map((v: { slug: string }) => v.slug)).toEqual(['arena-two']);

    expect((await api().delete(path('arena-one')).set(...bearer(player.token))).status).toBe(204);
    expect(await SavedVenue.countDocuments({ userId: player.userId })).toBe(1);
  });

  it(`stops at ${MAX_SAVED_VENUES}; saving one already saved still works`, async () => {
    const venue = await seedVenue(owner.ownerId, { slug: 'arena-one', published: true });
    await seedVenue(owner.ownerId, { slug: 'arena-two', published: true });
    await SavedVenue.create({ userId: player.userId, venueId: venue._id });
    await SavedVenue.insertMany(
      Array.from({ length: MAX_SAVED_VENUES - 1 }, () => ({ userId: player.userId, venueId: new Venue()._id })),
    );
    const res = await api().put(path('arena-two')).set(...bearer(player.token));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('saved_venues_full');
    expect((await api().put(path('arena-one')).set(...bearer(player.token))).status).toBe(200);
  });

  it('deleting a venue drops its saves', async () => {
    const venue = await seedVenue(owner.ownerId, { slug: 'arena-one', published: true });
    await api().put(path('arena-one')).set(...bearer(player.token));
    const res = await api().delete(`/api/v1/owners/${owner.ownerId}/venues/${venue.id}`).set(...bearer(owner.token));
    expect(res.status).toBe(204);
    expect(await SavedVenue.countDocuments({})).toBe(0);
  });
});
