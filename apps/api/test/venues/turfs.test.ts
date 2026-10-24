import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Booking } from '../../src/bookings/booking.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(), Booking.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let v1: string;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ActivityLog.deleteMany({}).setOptions({ crossTenant: true }),
    Venue.deleteMany({}).setOptions({ crossTenant: true }),
    Turf.deleteMany({}).setOptions({ crossTenant: true }),
    Booking.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
  v1 = (await seedVenue(a.ownerId)).id as string;
});

const api = () => request(ctx.app);
const turfs = (venueId = v1, rest = '', ownerId = a.ownerId) =>
  `/api/v1/owners/${ownerId}/venues/${venueId}/turfs${rest}`;
const venueUrl = (venueId = v1) => `/api/v1/owners/${a.ownerId}/venues/${venueId}`;
const body = (over: object = {}) => ({ name: 'Court 1', sports: ['football'], indoor: true, slotLengthMin: 60, ...over });
const createTurf = (over: object = {}, venueId = v1, token = a.token) =>
  api().post(turfs(venueId)).set(...bearer(token)).send(body(over));

describe('turfs API', () => {
  it('creates a turf; effective settings layer owner → venue → turf hours', async () => {
    await api().patch(venueUrl()).set(...bearer(a.token))
      .send({ settings: { hours: { fri: { open: '16:00', close: '02:00' } } } });
    const res = await createTurf({ settings: { hours: { mon: 'closed' } } });
    expect(res.status).toBe(201);
    const hours = res.body.turf.effectiveSettings.hours;
    expect(hours.mon).toBe('closed');
    expect(hours.fri).toEqual({ open: '16:00', close: '02:00' });
    expect(hours.tue).toEqual({ open: '08:00', close: '22:00' });
    expect(res.body.turf).toMatchObject({ venueId: v1, name: 'Court 1', slotLengthMin: 60, active: true });
    const row = await ActivityLog.findOne({ ownerId: a.ownerId, action: 'turf.create' }).lean();
    expect(String(row!.venueId)).toBe(v1);
  });

  it('validates turf fields', async () => {
    for (const over of [{ slotLengthMin: 50 }, { slotLengthMin: 20 }, { slotLengthMin: 250 }, { sports: [] }, { sports: ['curling'] }]) {
      const res = await createTurf(over);
      expect(res.status, JSON.stringify(over)).toBe(400);
    }
    const { id } = (await createTurf()).body.turf;
    const res = await api().patch(turfs(v1, `/${id}`)).set(...bearer(a.token)).send({ slotLengthMin: 90 });
    expect(res.status).toBe(400);
  });

  it('turf names unique per venue, case-insensitive', async () => {
    expect((await createTurf()).status).toBe(201);
    const dup = await createTurf({ name: 'court 1' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('turf_name_taken');
    const v2 = (await seedVenue(a.ownerId)).id as string;
    expect((await createTurf({}, v2)).status).toBe(201);
  });

  it('turf of another venue or owner → 404', async () => {
    const v2 = (await seedVenue(a.ownerId)).id as string;
    const t2 = await seedTurf(a.ownerId, v2);
    const cross = await api().get(turfs(v1, `/${t2.id}`)).set(...bearer(a.token));
    expect(cross.status).toBe(404);
    expect(cross.body.error.message).toBe('Turf not found');

    const b = await seedOwner(ctx.services);
    const bVenue = (await seedVenue(b.ownerId)).id as string;
    const foreign = await api().get(turfs(bVenue)).set(...bearer(a.token));
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.message).toBe('Venue not found');

    const m = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: [v1] });
    expect((await api().get(turfs(v2)).set(...bearer(m.token))).status).toBe(404);
    expect((await api().get(turfs(v1)).set(...bearer(m.token))).status).toBe(200);
  });

  it('publish needs an active turf', async () => {
    const early = await api().patch(venueUrl()).set(...bearer(a.token)).send({ published: true });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('venue_not_ready');
    await createTurf();
    const ok = await api().patch(venueUrl()).set(...bearer(a.token)).send({ published: true });
    expect(ok.status).toBe(200);
    expect(ok.body.venue.published).toBe(true);
    expect(await ActivityLog.exists({ ownerId: a.ownerId, action: 'venue.publish' })).not.toBeNull();
  });

  it('cannot deactivate or delete the last active turf of a published venue', async () => {
    const { id } = (await createTurf()).body.turf;
    await api().patch(venueUrl()).set(...bearer(a.token)).send({ published: true });
    const off = await api().patch(turfs(v1, `/${id}`)).set(...bearer(a.token)).send({ active: false });
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('last_active_turf');
    const del = await api().delete(turfs(v1, `/${id}`)).set(...bearer(a.token));
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('last_active_turf');
    await createTurf({ name: 'Court 2' });
    expect((await api().patch(turfs(v1, `/${id}`)).set(...bearer(a.token)).send({ active: false })).status).toBe(200);
  });

  it('refuses delete when the turf has bookings', async () => {
    const { id } = (await createTurf()).body.turf;
    const startAt = new Date('2026-02-01T10:00:00Z');
    const endAt = new Date('2026-02-01T11:00:00Z');
    await Booking.create({
      ownerId: a.ownerId, venueId: v1, turfId: id, reference: 'REF00001', businessDate: '2026-02-01', startAt, endAt,
      slots: [{ startAt, endAt, price: 1000 }], currency: 'BDT', subtotal: 1000, addonsTotal: 0, total: 1000,
      advanceRequired: 0, status: 'cancelled', paymentStatus: 'unpaid', source: 'online',
      policySnapshot: { paymentPolicy: { type: 'none' }, refundRules: [] },
    });
    const del = await api().delete(turfs(v1, `/${id}`)).set(...bearer(a.token));
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('turf_has_bookings');
    expect(await Turf.exists({ ownerId: a.ownerId, _id: id })).not.toBeNull();
    await Booking.deleteMany({}).setOptions({ crossTenant: true });
    expect((await api().delete(turfs(v1, `/${id}`)).set(...bearer(a.token))).status).toBe(204);
  });

  it('venue delete', async () => {
    const { id } = (await createTurf()).body.turf;
    const m = await addMember(ctx.services, a.ownerId, { venueIds: [v1] });
    const blocked = await api().delete(venueUrl()).set(...bearer(a.token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('venue_has_turfs');
    expect((await api().delete(turfs(v1, `/${id}`)).set(...bearer(a.token))).status).toBe(204);
    expect((await api().delete(venueUrl()).set(...bearer(a.token))).status).toBe(204);
    const member = await Membership.findOne({ ownerId: a.ownerId, _id: m.membershipId }).lean();
    expect(member!.venueIds).toEqual([]);
    expect(await ActivityLog.exists({ ownerId: a.ownerId, action: 'venue.delete' })).not.toBeNull();
    expect((await api().get(venueUrl()).set(...bearer(a.token))).status).toBe(404);
  });

  it('staff cannot write turfs → 403; staff can list turfs of their venue → 200', async () => {
    const staff = await addMember(ctx.services, a.ownerId, { venueIds: [v1] });
    const res = await createTurf({}, v1, staff.token);
    expect(res.status).toBe(403);
    await seedTurf(a.ownerId, v1);
    const list = await api().get(turfs()).set(...bearer(staff.token));
    expect(list.status).toBe(200);
    expect(list.body.turfs).toHaveLength(1);
  });
});
