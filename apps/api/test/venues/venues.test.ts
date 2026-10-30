import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { DEFAULT_OWNER_SETTINGS } from '@booking/shared';
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

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init()]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    Role.deleteMany({ ownerId: { $ne: null } }),
    ActivityLog.deleteMany({}).setOptions({ crossTenant: true }),
    Venue.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
});

const api = () => request(ctx.app);
const oid = () => new mongoose.Types.ObjectId().toString();
const url = (rest = '', ownerId = a.ownerId) => `/api/v1/owners/${ownerId}/venues${rest}`;
const create = (body: object, token = a.token) => api().post(url()).set(...bearer(token)).send(body);
const patch = (id: string, body: object, token = a.token) =>
  api().patch(url(`/${id}`)).set(...bearer(token)).send(body);
const valid = (over: object = {}) => ({
  name: 'Green Turf',
  address: 'Road 1',
  city: 'Dhaka',
  country: 'BD',
  timezone: 'Asia/Dhaka',
  location: { lat: 23.81, lng: 90.41 },
  ...over,
});

describe('venues API', () => {
  it('owner creates a venue with defaults', async () => {
    const res = await create({
      name: 'Арена Москва',
      address: 'ул. Ленина 1',
      city: 'Москва',
      country: 'RU',
      timezone: 'Europe/Moscow',
      location: { lat: 55.75, lng: 37.61 },
    });
    expect(res.status).toBe(201);
    expect(res.body.venue).toMatchObject({
      slug: 'arena-moskva',
      currency: 'BDT',
      published: false,
      settings: {},
      location: { lat: 55.75, lng: 37.61 },
    });
    expect(res.body.venue.effectiveSettings).toEqual(DEFAULT_OWNER_SETTINGS);
    const row = await ActivityLog.findOne({ ownerId: a.ownerId, action: 'venue.create' }).lean();
    expect(String(row!.venueId)).toBe(res.body.venue.id);
  });

  it('stores location as [lng, lat] and rejects out-of-range', async () => {
    const res = await create(valid());
    const doc = await Venue.findOne({ ownerId: a.ownerId, _id: res.body.venue.id }).lean();
    expect(doc!.location!.coordinates).toEqual([90.41, 23.81]);
    expect((await create(valid({ location: { lat: 91, lng: 0 } }))).status).toBe(400);
    expect((await create(valid({ location: { lat: 0, lng: 181 } }))).status).toBe(400);
  });

  it('rejects bad timezone, country and currency', async () => {
    for (const over of [{ timezone: 'Asia/Dhak' }, { country: 'ru' }, { currency: 'XXX' }]) {
      const res = await create(valid(over));
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
  });

  it('duplicate names get suffixed slugs; explicit taken slug → 409 slug_taken', async () => {
    const one = await create(valid());
    const two = await create(valid());
    expect(one.body.venue.slug).toBe('green-turf');
    expect(two.body.venue.slug).toBe('green-turf-2');
    const taken = await create(valid({ slug: 'green-turf' }));
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('slug_taken');
    const renamed = await patch(two.body.venue.id, { slug: 'green-turf' });
    expect(renamed.status).toBe(409);
    expect(renamed.body.error.code).toBe('slug_taken');
  });

  it('generated slug never 409s once the numbered suffixes are used up', async () => {
    const other = new mongoose.Types.ObjectId().toString();
    await seedVenue(other, { slug: 'venue' });
    for (let n = 2; n <= 20; n++) await seedVenue(other, { slug: `venue-${n}` });
    const res = await create(valid({ name: 'খেলার মাঠ' }));
    expect(res.status).toBe(201);
    expect(res.body.venue.slug).toMatch(/^venue-[a-z0-9]{6}$/);
  });

  it('PATCH merges venue settings over owner settings', async () => {
    await api().patch(`/api/v1/owners/${a.ownerId}/settings`).set(...bearer(a.token))
      .send({ guestBooking: { allowed: true, requireOtp: false } });
    const { id } = (await create(valid())).body.venue;
    const paymentMethods = { manualWallets: [{ provider: 'bkash', number: '01712345678', accountType: 'personal' }], gateways: [] };
    const fixed = await patch(id, { settings: { paymentPolicy: { type: 'partial_fixed', amount: 50000 }, paymentMethods } });
    expect(fixed.status).toBe(200);
    expect(fixed.body.venue.effectiveSettings.paymentPolicy).toEqual({ type: 'partial_fixed', amount: 50000 });
    expect(fixed.body.venue.effectiveSettings.guestBooking.allowed).toBe(false);
    const reset = await patch(id, { settings: { paymentPolicy: null, paymentMethods: null } });
    expect(reset.body.venue.settings).toEqual({});
    expect(reset.body.venue.effectiveSettings.paymentPolicy).toEqual({ type: 'none' });
    expect(reset.body.venue.effectiveSettings.guestBooking.allowed).toBe(true);
  });

  it('currency cannot be changed', async () => {
    const { id } = (await create(valid())).body.venue;
    expect((await patch(id, { currency: 'USD' })).status).toBe(400);
  });

  it('venue scope', async () => {
    const v1 = await seedVenue(a.ownerId);
    const v2 = await seedVenue(a.ownerId);
    const m = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: [v1.id as string] });
    const list = await api().get(url()).set(...bearer(m.token));
    expect(list.body.venues.map((v: { id: string }) => v.id)).toEqual([v1.id]);

    const hidden = await api().get(url(`/${v2.id}`)).set(...bearer(m.token));
    const random = await api().get(url(`/${oid()}`)).set(...bearer(m.token));
    const b = await seedOwner(ctx.services);
    const bVenue = await seedVenue(b.ownerId);
    const foreign = await api().get(url(`/${bVenue.id}`)).set(...bearer(a.token));
    for (const res of [hidden, random, foreign]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'not_found', message: 'Venue not found' } });
    }
    expect((await api().get(url(`/${v1.id}`)).set(...bearer(m.token))).status).toBe(200);
  });

  it('create needs all-venue scope and venue.manage', async () => {
    const v1 = await seedVenue(a.ownerId);
    const role = await Role.create({ ownerId: a.ownerId, name: 'Venue boss', permissions: ['venue.manage'] });
    const limited = await addMember(ctx.services, a.ownerId, { roleId: role.id as string, venueIds: [v1.id as string] });
    const res = await create(valid(), limited.token);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    const staff = await addMember(ctx.services, a.ownerId);
    const res2 = await create(valid(), staff.token);
    expect(res2.status).toBe(403);
    expect(res2.body.error.code).toBe('forbidden');
  });
});
