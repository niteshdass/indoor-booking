import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { DEFAULT_OWNER_SETTINGS, type OwnerSettings } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { seedVenue } from '../helpers/venues';

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
    ActivityLog.deleteMany({}).setOptions({ crossTenant: true }),
    Venue.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
});

const url = (ownerId = a.ownerId) => `/api/v1/owners/${ownerId}/settings`;
const get = (token = a.token) => request(ctx.app).get(url()).set(...bearer(token));
const patch = (body: object, token = a.token) =>
  request(ctx.app).patch(url()).set(...bearer(token)).send(body);

describe('owner settings', () => {
  it('GET returns defaults for a fresh owner', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ settings: DEFAULT_OWNER_SETTINGS });
  });

  it('PATCH sets, merges hours, and null resets', async () => {
    expect((await patch({ weekendDays: ['fri', 'sat'], hours: { fri: 'closed' } })).status).toBe(200);
    expect((await patch({ hours: { sat: { open: '10:00', close: '02:00' } } })).status).toBe(200);
    const { settings } = (await get()).body;
    expect(settings.weekendDays).toEqual(['fri', 'sat']);
    expect(settings.hours.fri).toBe('closed');
    expect(settings.hours.sat).toEqual({ open: '10:00', close: '02:00' });
    expect(settings.hours.mon).toEqual({ open: '08:00', close: '22:00' });
    const reset = await patch({ weekendDays: null });
    expect(reset.body.settings.weekendDays).toEqual(['sat', 'sun']);
  });

  it('refund rules are sorted and validated', async () => {
    const res = await patch({
      refundRules: [{ minHoursBefore: 48, percent: 20 }, { minHoursBefore: 96, percent: 100 }],
    });
    expect(res.body.settings.refundRules).toEqual([
      { minHoursBefore: 96, percent: 100 },
      { minHoursBefore: 48, percent: 20 },
    ]);
    for (const refundRules of [
      [{ minHoursBefore: 48, percent: 20 }, { minHoursBefore: 48, percent: 50 }],
      [{ minHoursBefore: 48, percent: 101 }],
      [{ minHoursBefore: 48, percent: 12.345 }],
    ]) {
      const bad = await patch({ refundRules });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('validation_error');
    }
  });

  it('owner level rejects fixed advance and bad values', async () => {
    for (const body of [
      { paymentPolicy: { type: 'partial_fixed', amount: 500 } },
      { hours: { mon: { open: '25:00', close: '10:00' } } },
      { unknownKey: 1 },
      { bookingWindowDays: 0 },
    ]) {
      const res = await patch(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
  });

  it('staff without settings.edit → 403 forbidden; non-member → 404', async () => {
    const staff = await addMember(ctx.services, a.ownerId);
    const res = await patch({ bookingWindowDays: 10 }, staff.token);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    expect((await get(staff.token)).status).toBe(200);
    const b = await seedOwner(ctx.services);
    expect((await get(b.token)).status).toBe(404);
  });

  it('PATCH writes a settings.update activity entry', async () => {
    await patch({ bookingWindowDays: 60 });
    const row = await ActivityLog.findOne({ ownerId: a.ownerId, action: 'settings.update' }).lean();
    expect(row).toMatchObject({ entity: 'owner', after: { bookingWindowDays: 60 } });
    expect(row!.before ?? {}).toEqual({}); // ActivityLog minimizes an empty object away
    expect(String(row!.entityId)).toBe(a.ownerId);
  });

  it('a weekday set to null resets only that day', async () => {
    const venue = await seedVenue(a.ownerId, {
      settings: { hours: { mon: 'closed', fri: { open: '16:00', close: '02:00' } } },
    });
    const res = await request(ctx.app)
      .patch(`/api/v1/owners/${a.ownerId}/venues/${venue.id}`)
      .set(...bearer(a.token))
      .send({ settings: { hours: { mon: null } } });
    expect(res.status).toBe(200);
    expect(res.body.venue.settings.hours).toEqual({ fri: { open: '16:00', close: '02:00' } });
    expect(res.body.venue.effectiveSettings.hours.mon).toEqual({ open: '08:00', close: '22:00' });
  });
});

describe('payment methods', () => {
  const wallet = (over: object = {}) => ({ provider: 'bkash', number: '01712345678', accountType: 'personal', ...over });
  const methods = (manualWallets: object[], gateways: string[] = []) => ({ manualWallets, gateways });

  it('PATCH owner settings stores paymentMethods with the wallet number normalised', async () => {
    const res = await patch({ paymentMethods: methods([wallet()]) });
    expect(res.status).toBe(200);
    expect(res.body.settings.paymentMethods.manualWallets[0].number).toBe('+8801712345678');
    const owner = await Owner.findById(a.ownerId).lean();
    expect((owner!.settings as Partial<OwnerSettings>).paymentMethods!.manualWallets[0]!.number).toBe('+8801712345678');
  });

  it('rejects a wallet number that is not a BD mobile', async () => {
    expect((await patch({ paymentMethods: methods([wallet({ number: '+8802123456' })]) })).status).toBe(400);
  });

  it('rejects two wallets for the same provider', async () => {
    const res = await patch({ paymentMethods: methods([wallet(), wallet({ number: '01812345678' })]) });
    expect(res.status).toBe(400);
  });

  it('refuses an advance with no way to pay', async () => {
    const res = await patch({ paymentPolicy: { type: 'full' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('no_payment_method');
  });

  it('accepts an advance once a wallet is set', async () => {
    expect((await patch({ paymentPolicy: { type: 'full' }, paymentMethods: methods([wallet()]) })).status).toBe(200);
  });

  it('still saves hours for an owner whose advance has no methods', async () => {
    await Owner.updateOne({ _id: a.ownerId }, { $set: { settings: { paymentPolicy: { type: 'full' } } } });
    const res = await patch({ hours: { mon: 'closed' } });
    expect(res.status).toBe(200);
  });

  it("venue paymentMethods replaces the owner's", async () => {
    const venue = await seedVenue(a.ownerId);
    const res = await request(ctx.app)
      .patch(`/api/v1/owners/${a.ownerId}/venues/${venue.id}`)
      .set(...bearer(a.token))
      .send({ settings: { paymentMethods: methods([wallet({ provider: 'nagad' })]) } });
    expect(res.status).toBe(200);
    expect(res.body.venue.effectiveSettings.paymentMethods).toEqual(res.body.venue.settings.paymentMethods);
    expect(res.body.venue.effectiveSettings.paymentMethods.manualWallets[0]).toMatchObject({ provider: 'nagad', number: '+8801712345678' });
  });
});
