import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { SPORTS, WEEKDAYS } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner, seedUser } from '../helpers/tenancy';
import { seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { PlatformLog } from '../../src/admin/platformLog.model';
import { PlatformSettings, clearSettingsCache } from '../../src/admin/settings';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(), PlatformLog.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let user: Awaited<ReturnType<typeof seedUser>>;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    PlatformLog.deleteMany({}),
    PlatformSettings.deleteMany({}),
    ...[Membership, ActivityLog, Venue, Turf].map((m) => (m as typeof Venue).deleteMany({}).setOptions({ crossTenant: true })),
  ]);
  clearSettingsCache();
  ctx = buildTestApp();
  user = await seedUser(ctx.services, { name: 'Rahim' });
});

const hours = Object.fromEntries(WEEKDAYS.map((d) => [d, d === 'fri' ? 'closed' : { open: '06:00', close: '00:00' }]));
const turf = (name: string) => ({
  name,
  sports: ['football', 'cricket'],
  indoor: false,
  slotLengthMin: 90,
  pricing: { base: 150000, rules: [{ kind: 'weekday', range: { start: '17:00', end: '00:00' }, price: 200000 }] },
});
const setup = (over: Record<string, unknown> = {}) => ({
  venue: { name: 'Dhanmondi Turf', address: 'Road 8', city: 'Dhaka', timezone: 'Asia/Dhaka', location: { lat: 23.75, lng: 90.37 } },
  turfs: [turf('Turf 1'), turf('Turf 2')],
  settings: {
    hours,
    weekendDays: ['fri', 'sat'],
    paymentMethods: { manualWallets: [{ provider: 'bkash', number: '01712345678', accountType: 'personal' }], gateways: [] },
  },
  publish: true,
  ...over,
});
const business = { name: 'Dhanmondi Turf', country: 'BD', currency: 'BDT', locale: 'bn' };
const post = (body: object, token = user.token) => request(ctx.app).post('/api/v1/onboarding').set(...bearer(token)).send(body);
const approveAutomatically = () =>
  PlatformSettings.updateOne(
    { _id: 'platform' },
    { $set: { general: { ownerApproval: 'automatic', fee: { mode: 'none', fixed: null, percent: null, payer: 'player' }, payout: { bkash: null, nagad: null, stripe: null } } } },
    { upsert: true },
  ).then(clearSettingsCache);

describe('POST /onboarding', () => {
  it('creates the business, venue, turfs with prices and the owner settings in one go; waits for approval hidden', async () => {
    const res = await post({ business, ...setup() });
    expect(res.status).toBe(201);
    expect(res.body.owner).toMatchObject({ name: 'Dhanmondi Turf', status: 'pending_approval' });
    expect(res.body.venue).toMatchObject({ slug: 'dhanmondi-turf', published: false });

    const owner = (await Owner.findById(res.body.owner.id).lean())!;
    expect(owner).toMatchObject({ country: 'BD', defaultCurrency: 'BDT', defaultLocale: 'bn' });
    expect(owner.settings).toMatchObject({ weekendDays: ['fri', 'sat'], hours: { fri: 'closed', mon: { open: '06:00', close: '00:00' } } });
    // Stored normalized, like the settings form.
    expect((owner.settings as { paymentMethods: { manualWallets: { number: string }[] } }).paymentMethods.manualWallets[0]!.number).toBe('+8801712345678');

    const venue = (await Venue.findById(res.body.venue.id).setOptions({ crossTenant: true }).lean())!;
    expect(venue).toMatchObject({ country: 'BD', currency: 'BDT', timezone: 'Asia/Dhaka', settings: {} });
    expect(venue.location!.coordinates).toEqual([90.37, 23.75]);
    const turfs = await Turf.find({ venueId: venue._id }).setOptions({ crossTenant: true }).sort({ name: 1 }).lean();
    expect(turfs.map((t) => [t.name, t.slotLengthMin, t.indoor, (t.pricing as { base: number }).base])).toEqual([
      ['Turf 1', 90, false, 150000],
      ['Turf 2', 90, false, 150000],
    ]);
    const membership = await Membership.findOne({ userId: user.userId }).setOptions({ crossTenant: true }).lean();
    expect(membership!.allVenues).toBe(true);
    const actions = (await ActivityLog.find({ ownerId: owner._id }).lean()).map((l) => l.action).sort();
    expect(actions).toEqual(['owner.create', 'settings.update', 'turf.create', 'turf.create', 'venue.create']);
  });

  it('publishes straight away when the platform approves businesses automatically', async () => {
    await approveAutomatically();
    const res = await post({ business, ...setup() });
    expect(res.status).toBe(201);
    expect(res.body.owner.status).toBe('active');
    expect(res.body.venue.published).toBe(true);
    const unpublished = await post({ business: { ...business, name: 'Second' }, ...setup({ publish: false }) });
    expect(unpublished.body.venue).toMatchObject({ slug: 'dhanmondi-turf-2', published: false });
  });

  it('refuses a second application while one waits, and writes nothing', async () => {
    expect((await post({ business, ...setup() })).status).toBe(201);
    const again = await post({ business, ...setup() });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('application_pending');
    expect(await Owner.countDocuments()).toBe(1);
  });

  it('rejects bad answers before writing anything', async () => {
    const bad = [
      setup({ turfs: [] }),
      setup({ turfs: [turf('Turf 1'), turf('turf 1')] }),
      setup({ turfs: [{ ...turf('A'), slotLengthMin: 50 }] }),
      setup({ turfs: [{ ...turf('A'), pricing: { base: -1, rules: [] } }] }),
      setup({ settings: { hours: { mon: 'closed' }, weekendDays: [], paymentMethods: { manualWallets: [], gateways: [] } } }),
      setup({ settings: { hours, weekendDays: [], paymentMethods: { manualWallets: [{ provider: 'bkash', number: '123', accountType: 'personal' }], gateways: [] } } }),
      setup({ venue: { name: '', address: 'x', city: 'y', timezone: 'Asia/Dhaka', location: { lat: 0, lng: 0 } } }),
    ];
    for (const body of bad) {
      const res = await post({ business, ...body });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await post(setup())).status).toBe(400);
    expect(await Owner.countDocuments()).toBe(0);
    expect(await Venue.countDocuments().setOptions({ crossTenant: true })).toBe(0);
  });

  it('refuses sports the platform switched off', async () => {
    await PlatformSettings.updateOne(
      { _id: 'platform' },
      { $set: { sports: SPORTS.map((sport) => ({ sport, enabled: sport !== 'cricket' })) } },
      { upsert: true },
    );
    clearSettingsCache();
    const res = await post({ business, ...setup() });
    expect(res.body.error.code).toBe('sport_disabled');
    expect(await Owner.countDocuments()).toBe(0);
  });

  it('needs a signed-in user', async () => {
    const res = await request(ctx.app).post('/api/v1/onboarding').send({ business, ...setup() });
    expect(res.status).toBe(401);
  });
});

describe('POST /owners/:ownerId/onboarding', () => {
  it('adds a venue with its own hours and payment methods, leaving the owner settings alone', async () => {
    const a = await seedOwner(ctx.services);
    const res = await request(ctx.app).post(`/api/v1/owners/${a.ownerId}/onboarding`).set(...bearer(a.token)).send(setup());
    expect(res.status).toBe(201);
    expect(res.body.venue.published).toBe(true);
    const venue = (await Venue.findById(res.body.venue.id).setOptions({ crossTenant: true }).lean())!;
    expect(venue.currency).toBe('BDT');
    expect(venue.settings).toMatchObject({ weekendDays: ['fri', 'sat'], hours: { fri: 'closed' } });
    expect((await Owner.findById(a.ownerId).lean())!.settings).toEqual({});
    expect(await Turf.countDocuments({ venueId: venue._id }).setOptions({ crossTenant: true })).toBe(2);
  });

  it('is for members who manage every venue', async () => {
    const a = await seedOwner(ctx.services);
    const v = await seedVenue(a.ownerId);
    const staff = await addMember(ctx.services, a.ownerId);
    const limited = await addMember(ctx.services, a.ownerId, { roleKey: 'owner', venueIds: [v.id as string] });
    for (const token of [staff.token, limited.token]) {
      const res = await request(ctx.app).post(`/api/v1/owners/${a.ownerId}/onboarding`).set(...bearer(token)).send(setup());
      expect(res.status).toBe(403);
    }
  });
});
