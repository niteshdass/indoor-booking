import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner, seedUser } from '../helpers/tenancy';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Booking } from '../../src/bookings/booking.model';
import { PlatformLog } from '../../src/admin/platformLog.model';
import { PlatformSettings, clearSettingsCache } from '../../src/admin/settings';
import { PlatformPayout } from '../../src/platform/payout.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Booking.init(), PlatformLog.init(),
    PlatformPayout.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const oid = () => new mongoose.Types.ObjectId();
let ctx: ReturnType<typeof buildTestApp>;
let admin: Awaited<ReturnType<typeof seedUser>>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let seq = 0;

const bkash = { provider: 'bkash', number: '01712345678', accountType: 'personal' };

async function setGeneral(over: { fee?: object; payout?: object } = {}) {
  await PlatformSettings.updateOne(
    { _id: 'platform' },
    {
      $set: {
        general: {
          ownerApproval: 'manual',
          fee: { mode: 'fixed', fixed: 50, percent: null, payer: 'owner' },
          payout: { bkash, nagad: null, stripe: null },
          ...over,
        },
      },
    },
    { upsert: true },
  );
  clearSettingsCache();
}

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    PlatformLog.deleteMany({}),
    PlatformSettings.deleteMany({}),
    ...[Membership, ActivityLog, Venue, Booking, PlatformPayout].map((m) => (m as typeof Venue).deleteMany({}).setOptions({ crossTenant: true })),
  ]);
  clearSettingsCache();
  ctx = buildTestApp();
  admin = await seedUser(ctx.services, { name: 'Admin', platformAdmin: true });
  a = await seedOwner(ctx.services, { name: 'Arena' });
  await setGeneral();
});

const api = (path: string) => `/api/v1${path}`;
const get = (path: string, token = a.token) => request(ctx.app).get(api(path)).set(...bearer(token));
const post = (path: string, body: object = {}, token = a.token) => request(ctx.app).post(api(path)).set(...bearer(token)).send(body);
const fee = () => get(`/owners/${a.ownerId}/platform-fee`);
const pay = (body: object = {}, token = a.token) =>
  post(
    `/owners/${a.ownerId}/platform-payouts`,
    { currency: 'BDT', amount: 6000, method: 'bkash', trxId: 'ABC12345XY', senderNumber: '01812345678', ...body },
    token,
  );
const bdt = async () => (await fee()).body.balances.find((b: { currency: string }) => b.currency === 'BDT');

async function booking(status: string, over: Record<string, unknown> = {}) {
  seq += 1;
  const startAt = new Date(ctx.services.now().getTime() + 86_400_000);
  const endAt = new Date(startAt.getTime() + 3_600_000);
  return Booking.create({
    ownerId: a.ownerId, venueId: oid(), turfId: oid(), reference: `PAY${seq}`, businessDate: '2026-01-01',
    startAt, endAt, slots: [{ startAt, endAt, price: 100000 }], currency: 'BDT', subtotal: 100000, addonsTotal: 0,
    total: 100000, advanceRequired: 0, status, paymentStatus: 'unpaid', source: 'online', policySnapshot: {},
    platformFee: { mode: 'fixed', value: 50, payer: 'owner', amount: 5000 },
    ...over,
  });
}

async function owing() {
  for (const s of ['confirmed', 'pending', 'cancelled', 'awaiting_payment']) await booking(s);
}

describe('owner platform balance', () => {
  it('balance counts owing bookings only', async () => {
    await owing();
    await booking('completed');
    await booking('no_show');
    for (const s of ['rejected', 'expired']) await booking(s);
    await booking('completed', { platformFee: null });
    const res = await fee();
    expect(res.status).toBe(200);
    expect(res.body.feeActive).toBe(true);
    expect(res.body.payer).toBe('owner');
    expect(res.body.balances).toEqual([{ currency: 'BDT', owed: 20000, paid: 0, pending: 0, balance: 20000, payable: 20000 }]);
    expect(res.body.methods).toEqual({ bkash, nagad: null, stripe: null });
  });

  it('free mode with zero balance', async () => {
    await setGeneral({ fee: { mode: 'free', fixed: null, percent: null, payer: 'owner' } });
    const res = await fee();
    expect(res.body.feeActive).toBe(false);
    expect(res.body.balances).toEqual([]);
    expect(res.body.payouts).toEqual([]);
  });
});

describe('manual payouts', () => {
  it('manual payout waits for admin', async () => {
    await owing();
    const res = await pay();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ownerId: a.ownerId, currency: 'BDT', amount: 6000, method: 'bkash', trxId: 'ABC12345XY', status: 'pending', reviewedAt: null });
    expect(await bdt()).toMatchObject({ owed: 10000, paid: 0, pending: 6000, balance: 10000, payable: 4000 });
    expect((await fee()).body.payouts.map((p: { id: string }) => p.id)).toEqual([res.body.id]);

    const queue = await get('/admin/payouts', admin.token);
    expect(queue.status).toBe(200);
    expect(queue.body.payouts).toHaveLength(1);
    expect(queue.body.payouts[0]).toMatchObject({ id: res.body.id, ownerName: 'Arena' });
    expect(queue.body.nextBefore).toBeNull();

    const ok = await post(`/admin/payouts/${res.body.id}/confirm`, {}, admin.token);
    expect(ok.status).toBe(200);
    expect(ok.body.payout.status).toBe('confirmed');
    expect(ok.body.payout.reviewedAt).not.toBeNull();
    expect(await bdt()).toMatchObject({ paid: 6000, pending: 0, balance: 4000, payable: 4000 });
    expect((await get('/admin/payouts', admin.token)).body.payouts).toHaveLength(0);
    expect((await get('/admin/payouts?status=all', admin.token)).body.payouts).toHaveLength(1);
    expect(await PlatformLog.countDocuments({ action: 'payout.confirmed', entityId: a.ownerId })).toBe(1);
    const logged = await PlatformLog.findOne({ action: 'payout.confirmed', entityId: a.ownerId }).lean();
    expect(logged).toMatchObject({ payoutId: expect.anything(), amount: ok.body.payout.amount, currency: ok.body.payout.currency });
    expect(String(logged?.payoutId)).toBe(res.body.id);

    const again = await post(`/admin/payouts/${res.body.id}/confirm`, {}, admin.token);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('payout_not_pending');
  });

  it('rejected payout frees the amount', async () => {
    await owing();
    const res = await pay();
    expect((await post(`/admin/payouts/${res.body.id}/reject`, {}, admin.token)).status).toBe(400);
    const no = await post(`/admin/payouts/${res.body.id}/reject`, { reason: 'No such transfer' }, admin.token);
    expect(no.status).toBe(200);
    expect(no.body.payout).toMatchObject({ status: 'rejected', rejectReason: 'No such transfer' });
    expect(await bdt()).toMatchObject({ paid: 0, pending: 0, balance: 10000, payable: 10000 });
    expect((await PlatformPayout.findById(res.body.id).setOptions({ crossTenant: true }).lean())!.rejectReason).toBe('No such transfer');
    const log = await PlatformLog.findOne({ action: 'payout.rejected' }).lean();
    expect(log!.reason).toBe('No such transfer');
    expect((await post(`/admin/payouts/${res.body.id}/confirm`, {}, admin.token)).body.error.code).toBe('payout_not_pending');
    // History still shows the TrxID, and it can be sent again.
    expect((await fee()).body.payouts[0]).toMatchObject({ status: 'rejected', trxId: 'ABC12345XY' });
    const again = await pay();
    expect(again.status).toBe(201);
    expect(again.body.trxId).toBe('ABC12345XY');
  });

  it('rejects a second payout that would exceed what is owed', async () => {
    await owing();
    const [x, y] = await Promise.all([pay({ trxId: 'AAAA11111' }), pay({ trxId: 'BBBB22222' })]);
    expect([x.status, y.status].sort()).toEqual([201, 400]);
    expect((x.status === 400 ? x : y).body.error.code).toBe('amount_exceeds_balance');
    expect(await PlatformPayout.countDocuments({ ownerId: a.ownerId })).toBe(1);
  });

  it('checks the amount, TrxID and method', async () => {
    await owing();
    for (const amount of [0, 10001]) {
      const res = await pay({ amount });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('amount_exceeds_balance');
    }
    expect((await pay({ currency: 'USD', amount: 100 })).body.error.code).toBe('amount_exceeds_balance');
    expect((await pay({ trxId: 'no' })).body.error.code).toBe('invalid_trx_id');
    const stripe = await pay({ method: 'stripe' });
    expect(stripe.status).toBe(400);
    expect(stripe.body.error.code).toBe('method_unavailable');
    expect((await pay({ senderNumber: '12345' })).body.error.code).toBe('invalid_sender');
    expect((await pay({ trxId: 'abc 12345 xy', amount: 1000 })).status).toBe(201);
    // Reported as a duplicate even when the amount would also be refused.
    const dup = await pay({ amount: 100000 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('duplicate_trx');
  });

  it('method must be set up', async () => {
    await owing();
    const res = await pay({ method: 'nagad' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('method_unavailable');
  });

  it('cancelled booking after payout leaves a credit', async () => {
    const first = await booking('confirmed');
    await booking('completed');
    const res = await pay({ amount: 10000 });
    expect(res.status).toBe(201);
    await post(`/admin/payouts/${res.body.id}/confirm`, {}, admin.token);
    await Booking.updateOne({ ownerId: a.ownerId, _id: first._id }, { $set: { status: 'cancelled' } });
    expect(await bdt()).toMatchObject({ owed: 5000, paid: 10000, balance: -5000, payable: 0 });
    expect((await pay({ trxId: 'CCCC33333', amount: 1 })).body.error.code).toBe('amount_exceeds_balance');

    const owners = await get('/admin/owners', admin.token);
    const row = owners.body.owners.find((o: { id: string }) => o.id === a.ownerId);
    expect(row.owes).toEqual([{ currency: 'BDT', amount: -5000 }]);
  });

  it('pages the admin queue', async () => {
    await owing();
    for (let i = 0; i < 26; i++) {
      await PlatformPayout.create({ ownerId: a.ownerId, currency: 'BDT', amount: 1, method: 'bkash', trxId: `PAGE${String(i).padStart(5, '0')}`, status: 'pending', createdAt: ctx.services.now() });
    }
    const trx = (body: { payouts: { trxId: string }[] }) => body.payouts.map((p) => p.trxId);
    const all = Array.from({ length: 26 }, (_, i) => `PAGE${String(i).padStart(5, '0')}`);
    // Pending: oldest first.
    const one = await get('/admin/payouts', admin.token);
    expect(trx(one.body)).toEqual(all.slice(0, 25));
    const two = await get(`/admin/payouts?before=${one.body.nextBefore}`, admin.token);
    expect(trx(two.body)).toEqual(all.slice(25));
    expect(two.body.nextBefore).toBeNull();
    // History: newest first.
    const h1 = await get('/admin/payouts?status=all', admin.token);
    expect(trx(h1.body)).toEqual([...all].reverse().slice(0, 25));
    const h2 = await get(`/admin/payouts?status=all&before=${h1.body.nextBefore}`, admin.token);
    expect(trx(h2.body)).toEqual([all[0]]);
    expect(h2.body.nextBefore).toBeNull();
  });
});

/** A platform user whose role has platform.view only. */
async function viewOnly() {
  seq += 1;
  const role = await Role.create({ ownerId: null, scope: 'platform', name: `Viewer ${seq}`, permissions: ['platform.view'] });
  const user = await seedUser(ctx.services, { name: 'View only' });
  await User.updateOne({ _id: user.userId }, { $set: { platformRoleId: role._id } });
  return user;
}

describe('permissions', () => {
  it('staff without settings.edit and platform users without platform.owners are refused', async () => {
    const staff = await addMember(ctx.services, a.ownerId);
    expect((await get(`/owners/${a.ownerId}/platform-fee`, staff.token)).status).toBe(403);
    expect((await pay({}, staff.token)).status).toBe(403);

    const user = await viewOnly();
    expect((await get('/admin/payouts', user.token)).status).toBe(403);
    expect((await post(`/admin/payouts/${oid()}/confirm`, {}, user.token)).status).toBe(403);
    expect((await get('/admin/payouts', a.token)).status).toBe(403);
  });

  it('owes appears on the owners list only, never on the overview', async () => {
    await owing();
    const user = await viewOnly();
    const overview = await get('/admin/overview', user.token);
    expect(overview.status).toBe(200);
    const rows = [...overview.body.pendingOwners, ...overview.body.newestOwners];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).not.toHaveProperty('owes');
    expect((await get('/admin/owners', user.token)).status).toBe(403);
    const list = await get('/admin/owners', admin.token);
    expect(list.body.owners.find((o: { id: string }) => o.id === a.ownerId).owes).toEqual([{ currency: 'BDT', amount: 10000 }]);
  });
});
