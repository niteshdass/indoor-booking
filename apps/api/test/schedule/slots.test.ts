import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { TurfPricing } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp, testConfig } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { signAccessToken } from '../../src/auth/jwt';
import { Closure } from '../../src/schedule/closure.model';
import { SlotOverride } from '../../src/schedule/slotOverride.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Closure.init(), SlotOverride.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

// Task 2 pricing fixture: weekday 22:00-02:00 costs 1200, so Friday's 01:00 slot is 1200.
const pricing: TurfPricing = {
  base: 1000,
  rules: [
    { kind: 'weekday', range: { start: '18:00', end: '22:00' }, price: 1400 },
    { kind: 'weekday', range: { start: '22:00', end: '02:00' }, price: 1200 },
    { kind: 'weekend', price: 1500 },
    { kind: 'date', date: '2026-12-16', range: { start: '16:00', end: '20:00' }, price: 2000 },
  ],
};

const day = '2026-10-30'; // a Friday
const T0 = Date.parse('2026-10-30T09:00:00Z'); // 15:00 Dhaka

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let v1: string;
let t1: string;
let slug: string;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ActivityLog.deleteMany({}).setOptions({ crossTenant: true }),
    Venue.deleteMany({}).setOptions({ crossTenant: true }),
    Turf.deleteMany({}).setOptions({ crossTenant: true }),
    Closure.deleteMany({}).setOptions({ crossTenant: true }),
    SlotOverride.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp();
  await setNow(T0);
  a = await seedOwner(ctx.services);
  const venue = await seedVenue(a.ownerId, { timezone: 'Asia/Dhaka', published: true });
  v1 = venue.id as string;
  slug = venue.slug;
  t1 = (await seedTurf(a.ownerId, v1, { slotLengthMin: 60, pricing, settings: { hours: { fri: { open: '16:00', close: '02:00' } } } })).id as string;
});

/** Moves the clock and re-signs the owner's access token, which would otherwise expire. */
async function setNow(ms: number) {
  ctx.services.clock.advance(ms - ctx.services.now().getTime());
  if (a) a.token = await signAccessToken(a.userId, testConfig.jwtSecret, ctx.services.now());
}

const api = () => request(ctx.app);
const ownerUrl = (venueId = v1, turfId = t1, ownerId = a.ownerId) =>
  `/api/v1/owners/${ownerId}/venues/${venueId}/turfs/${turfId}/slots`;
const getOwner = (q = `?date=${day}`, token = a.token, venueId = v1, turfId = t1) =>
  api().get(ownerUrl(venueId, turfId) + q).set(...bearer(token));
const pubUrl = (s = slug, turfId = t1) => `/api/v1/venues/${s}/turfs/${turfId}/slots`;
const getPublic = (q = `?date=${day}`, s = slug, turfId = t1) => api().get(pubUrl(s, turfId) + q);
const closure = (from: string, to = from, venueId: string | null = v1) =>
  Closure.create({ ownerId: a.ownerId, venueId, turfId: null, from, to, reason: 'Eid' });

describe('owner slots', () => {
  it('owner sees the day with prices and statuses', async () => {
    const res = await getOwner();
    expect(res.status).toBe(200);
    const d = res.body.day;
    expect(d).toMatchObject({ businessDate: day, currency: 'BDT', closed: false, inWindow: true });
    expect(d.slots).toHaveLength(10);
    expect(d.slots[0]).toMatchObject({ localStart: '16:00', status: 'available', source: 'hours' });
    expect(d.slots.find((s: { localStart: string }) => s.localStart === '01:00').price).toBe(1200);
  });

  it('closure, override and window feed in', async () => {
    await closure('2026-10-31');
    const sat = await getOwner();
    expect(sat.body.day.slots.some((s: { localStart: string }) => s.localStart === '01:00')).toBe(true);

    await SlotOverride.create({
      ownerId: a.ownerId, venueId: v1, turfId: t1, date: day, type: 'block', start: '16:00', end: '17:00',
    });
    expect((await getOwner()).body.day.slots[0].status).toBe('blocked');

    await setNow(Date.parse('2026-10-30T11:30:00Z'));
    expect((await getOwner()).body.day.slots[0].status).toBe('blocked');
    await SlotOverride.deleteMany({}).setOptions({ crossTenant: true });
    expect((await getOwner()).body.day.slots[0].status).toBe('past');

    await closure(day);
    const fri = (await getOwner()).body.day;
    expect(fri).toMatchObject({ closed: true, closedReason: 'Eid', slots: [] });
  });

  it('the earlier business day wins a slot both days reach', async () => {
    const hours = { tue: { open: '10:00', close: '12:00' }, wed: { open: '00:00', close: '02:00' } };
    const t2 = (await seedTurf(a.ownerId, v1, { slotLengthMin: 60, settings: { hours } })).id as string;
    // Stored directly: the API would reject this add for overlapping Wednesday's 00:00 slot.
    await SlotOverride.create({
      ownerId: a.ownerId, venueId: v1, turfId: t2, date: '2026-11-03', type: 'add', start: '23:00', end: '01:00',
    });
    const tue = (await getOwner('?date=2026-11-03', a.token, v1, t2)).body.day.slots;
    expect(tue.map((s: { localStart: string; source: string }) => [s.localStart, s.source])).toEqual([
      ['10:00', 'hours'],
      ['11:00', 'hours'],
      ['23:00', 'add'],
    ]);
    const wed = (await getOwner('?date=2026-11-04', a.token, v1, t2)).body.day.slots;
    expect(wed.map((s: { localStart: string }) => s.localStart)).toEqual(['01:00']);
  });

  it('includes inactive turfs and reports inWindow false outside the window', async () => {
    const off = (await seedTurf(a.ownerId, v1, { active: false })).id as string;
    expect((await getOwner(`?date=${day}`, a.token, v1, off)).status).toBe(200);
    expect((await getOwner('?date=2026-12-30')).body.day).toMatchObject({ inWindow: false });
    expect((await getOwner('?date=2026-12-30')).body.day.slots.length).toBeGreaterThan(0);
  });

  it('owner scope: manager limited to V1 reading V2 → 404', async () => {
    const v2 = (await seedVenue(a.ownerId)).id as string;
    const t2 = (await seedTurf(a.ownerId, v2)).id as string;
    const m = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: [v1] });
    expect((await getOwner(`?date=${day}`, m.token, v2, t2)).status).toBe(404);
    expect((await getOwner(`?date=${day}`, m.token)).status).toBe(200);
  });
});

describe('public slots', () => {
  it('public day', async () => {
    const res = await getPublic();
    expect(res.status).toBe(200);
    expect(res.body.day).toMatchObject({ businessDate: day, currency: 'BDT', status: 'open' });
    expect(res.body.day).not.toHaveProperty('closedReason');
    expect(Object.keys(res.body.day.slots[0]).sort()).toEqual(
      ['endAt', 'localEnd', 'localStart', 'price', 'startAt', 'status'].sort(),
    );

    const far = await getPublic('?date=2026-11-30'); // 31 days ahead, window 30
    expect(far.body.day).toMatchObject({ status: 'outside_window', slots: [] });
    expect((await getPublic('?date=2026-11-29')).body.day.status).toBe('open');

    await closure(day);
    expect((await getPublic()).body.day).toMatchObject({ status: 'closed', slots: [] });
  });

  it('public 404s', async () => {
    const ok = await getPublic();
    expect(ok.status).toBe(200);
    const inactive = (await seedTurf(a.ownerId, v1, { active: false })).id as string;
    const other = await seedVenue(a.ownerId, { published: true });
    const otherTurf = (await seedTurf(a.ownerId, other.id as string)).id as string;

    const turf404 = [await getPublic(`?date=${day}`, slug, inactive), await getPublic(`?date=${day}`, slug, otherTurf), await getPublic(`?date=${day}`, slug, 'nope')];
    for (const r of turf404) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual(turf404[0]!.body);
    }
    expect(turf404[0]!.body.error.message).toBe('Turf not found');

    const draft = await seedVenue(a.ownerId, { published: false });
    const draftTurf = (await seedTurf(a.ownerId, draft.id as string)).id as string;
    const venueRes = await getPublic(`?date=${day}`, draft.slug, draftTurf);
    const unknown = await getPublic(`?date=${day}`, 'no-such-venue', draftTurf);
    expect(venueRes.status).toBe(404);
    expect(venueRes.body).toEqual(unknown.body);
    expect(venueRes.body).toEqual((await api().get(`/api/v1/venues/${draft.slug}`)).body);

    await Owner.updateOne({ _id: a.ownerId }, { status: 'suspended' });
    const susp = await getPublic();
    expect(susp.status).toBe(404);
    expect(susp.body).toEqual(venueRes.body);
  });
});

describe('date validation', () => {
  it('bad date → 400 on both endpoints', async () => {
    for (const q of ['', '?date=2026-02-30', '?date=30-10-2026']) {
      for (const res of [await getOwner(q), await getPublic(q)]) {
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('validation_error');
      }
    }
  });
});
