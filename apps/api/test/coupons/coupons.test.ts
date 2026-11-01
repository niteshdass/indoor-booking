import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { signAccessToken } from '../../src/auth/jwt';
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
import { SlotLock } from '../../src/bookings/slotLock.model';
import { Payment } from '../../src/bookings/payment.model';
import { Coupon } from '../../src/coupons/coupon.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init(), Turf.init(), Booking.init(),
    SlotLock.init(), Payment.init(), Coupon.init(), ActivityLog.init(),
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

let ctx: ReturnType<typeof buildTestApp>;
let ownerId: string;
let ownerToken: string;
let venueId: string;
let slug: string;
let turfId: string;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[Venue, Turf, Booking, SlotLock, Payment, Coupon, ActivityLog].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions({ crossTenant: true }),
    ),
  ]);
  ctx = buildTestApp();
  ({ ownerId, token: ownerToken } = await seedOwner(ctx.services));
  await setup();
});

async function setup(settings: Record<string, unknown> = {}) {
  const venue = await seedVenue(ownerId, {
    published: true,
    slug: `arena-${Math.random().toString(36).slice(2, 8)}`,
    timezone: TZ,
    settings: { hours: HOURS, bookingWindowDays: 365, ...settings },
  });
  const turf = await seedTurf(ownerId, venue.id as string, { pricing: { base: 1500, rules: [] } });
  venueId = venue.id as string;
  slug = venue.slug;
  turfId = turf.id as string;
}

const coupons = `/api/v1/owners/`;
const ownerPath = (p = '') => `${coupons}${ownerId}/coupons${p}`;
const createCoupon = (body: Record<string, unknown>, token = ownerToken) =>
  request(ctx.app).post(ownerPath()).set(...bearer(token)).send(body);
const base = () => `/api/v1/venues/${slug}/turfs/${turfId}`;
const post = (path: string, body: unknown, auth?: string) => {
  const r = request(ctx.app).post(path);
  if (auth) r.set(...bearer(auth));
  return r.send(body as object);
};
async function newPlayer() {
  const u = await User.create({ name: 'Player', email: `p${Math.random()}@test.local` });
  return { userId: u.id as string, token: await signAccessToken(u.id as string, ctx.config.jwtSecret, ctx.services.now()) };
}
const quote = (couponCode: string, hms = ['18:00'], auth?: string) =>
  post(`${base()}/quote`, { date: D, startAts: hms.map(at), couponCode }, auth);

describe('owner coupons', () => {
  it('creates with an upper-cased code, lists with uses and logs activity', async () => {
    const res = await createCoupon({ code: ' summer10 ', type: 'percent', value: 10, maxDiscount: 500 });
    expect(res.status).toBe(201);
    expect(res.body.coupon).toMatchObject({
      code: 'SUMMER10', type: 'percent', value: 10, currency: 'BDT', venueIds: [], maxDiscount: 500,
      minSubtotal: 0, maxUses: null, active: true, uses: 0,
    });
    const list = await request(ctx.app).get(ownerPath()).set(...bearer(ownerToken));
    expect(list.body.coupons.map((c: { code: string }) => c.code)).toEqual(['SUMMER10']);
    expect(await ActivityLog.countDocuments({ ownerId, action: 'coupon.create' })).toBe(1);
  });

  it('refuses a taken code, bad values and unknown venues', async () => {
    await createCoupon({ code: 'EID', type: 'fixed', value: 500 });
    expect((await createCoupon({ code: 'eid', type: 'fixed', value: 100 })).body.error.code).toBe('coupon_code_taken');
    for (const bad of [
      { code: 'X', type: 'fixed', value: 100 },
      { code: 'PCT', type: 'percent', value: 120 },
      { code: 'PCT', type: 'percent', value: 10.555 },
      { code: 'FIX', type: 'fixed', value: 10.5 },
      { code: 'FIX', type: 'fixed', value: 100, maxDiscount: 50 },
      { code: 'WIN', type: 'fixed', value: 100, validFrom: '2026-02-01T00:00:00Z', validUntil: '2026-01-01T00:00:00Z' },
      { code: 'VEN', type: 'fixed', value: 100, venueIds: ['000000000000000000000000'] },
    ]) {
      expect((await createCoupon(bad)).status).toBe(400);
    }
  });

  it('patches, re-checks the merged coupon, and deletes', async () => {
    const id = (await createCoupon({ code: 'TEN', type: 'percent', value: 10 })).body.coupon.id;
    const patch = (body: unknown) => request(ctx.app).patch(ownerPath(`/${id}`)).set(...bearer(ownerToken)).send(body as object);
    expect((await patch({ active: false })).body.coupon.active).toBe(false);
    expect((await patch({ value: 150 })).status).toBe(400);
    expect((await patch({ type: 'fixed', value: 300 })).body.coupon).toMatchObject({ type: 'fixed', value: 300 });
    expect(await ActivityLog.countDocuments({ ownerId, action: 'coupon.update' })).toBe(2);
    expect((await request(ctx.app).delete(ownerPath(`/${id}`)).set(...bearer(ownerToken))).status).toBe(204);
    expect((await patch({ active: true })).status).toBe(404);
  });

  it('needs coupon.manage on all venues', async () => {
    const staff = await addMember(ctx.services, ownerId, { roleKey: 'staff' });
    expect((await request(ctx.app).get(ownerPath()).set(...bearer(staff.token))).status).toBe(403);
    expect((await createCoupon({ code: 'NOPE', type: 'fixed', value: 100 }, staff.token)).status).toBe(403);
    const scoped = await addMember(ctx.services, ownerId, { roleKey: 'manager', venueIds: [venueId] });
    expect((await request(ctx.app).get(ownerPath()).set(...bearer(scoped.token))).status).toBe(200);
    expect((await createCoupon({ code: 'NOPE', type: 'fixed', value: 100 }, scoped.token)).status).toBe(403);
    const manager = await addMember(ctx.services, ownerId, { roleKey: 'manager' });
    expect((await createCoupon({ code: 'YES', type: 'fixed', value: 100 }, manager.token)).status).toBe(201);
  });
});

describe('quote with a coupon', () => {
  it('takes a capped percent off slots and add-ons', async () => {
    await createCoupon({ code: 'HALF', type: 'percent', value: 50, maxDiscount: 1000 });
    const res = await quote('half', ['18:00', '19:00']);
    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({ subtotal: 3000, discount: 1000, total: 2000 });
    expect(res.body.coupon).toEqual({ code: 'HALF', type: 'percent', value: 50, discount: 1000 });
  });

  it('takes the advance on the discounted price', async () => {
    await setup({ paymentPolicy: { type: 'partial_percent', percent: 20 } });
    await createCoupon({ code: 'OFF500', type: 'fixed', value: 500 });
    const res = await quote('OFF500');
    expect(res.body.quote).toMatchObject({ subtotal: 1500, discount: 500, total: 1000, advanceRequired: 200 });
  });

  it('without a code has no discount', async () => {
    const res = await post(`${base()}/quote`, { date: D, startAts: [at('18:00')] });
    expect(res.body.quote.discount).toBe(0);
    expect(res.body.coupon).toBeNull();
  });

  it('refuses unknown, inactive, other-venue, early, late and too-small checkouts', async () => {
    const now = ctx.services.now().getTime();
    const day = 86_400_000;
    const otherVenue = venueId;
    await setup();
    await createCoupon({ code: 'OFF', type: 'fixed', value: 100, active: false });
    await createCoupon({ code: 'ELSEWHERE', type: 'fixed', value: 100, venueIds: [otherVenue] });
    await createCoupon({ code: 'SOON', type: 'fixed', value: 100, validFrom: new Date(now + day).toISOString() });
    await createCoupon({ code: 'GONE', type: 'fixed', value: 100, validUntil: new Date(now - day).toISOString() });
    await createCoupon({ code: 'BIG', type: 'fixed', value: 100, minSubtotal: 2000 });
    const codeOf = async (c: string) => (await quote(c)).body.error.code;
    expect(await codeOf('NOSUCH')).toBe('coupon_invalid');
    expect(await codeOf('OFF')).toBe('coupon_invalid');
    expect(await codeOf('ELSEWHERE')).toBe('coupon_invalid');
    expect(await codeOf('SOON')).toBe('coupon_not_started');
    expect(await codeOf('GONE')).toBe('coupon_expired');
    const big = await quote('BIG');
    expect(big.body.error).toMatchObject({ code: 'coupon_min_subtotal', details: { minSubtotal: 2000 } });
    expect((await quote('BIG', ['18:00', '19:00'])).status).toBe(200);
  });

  it('a fixed coupon does not work at a venue priced in another currency', async () => {
    await Venue.updateOne({ ownerId, _id: venueId }, { $set: { currency: 'USD' } });
    await createCoupon({ code: 'TAKA', type: 'fixed', value: 100 });
    await createCoupon({ code: 'PCT', type: 'percent', value: 10 });
    expect((await quote('TAKA')).body.error.code).toBe('coupon_invalid');
    expect((await quote('PCT')).status).toBe(200);
  });
});

describe('booking with a coupon', () => {
  it('stores the code and discount and nets the total', async () => {
    const { token } = await newPlayer();
    await createCoupon({ code: 'OFF300', type: 'fixed', value: 300 });
    const res = await post(`${base()}/bookings`, { date: D, startAts: [at('18:00')], couponCode: 'off300' }, token);
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ subtotal: 1500, total: 1200, coupon: { code: 'OFF300', discount: 300 } });
    const list = await request(ctx.app).get(ownerPath()).set(...bearer(ownerToken));
    expect(list.body.coupons[0].uses).toBe(1);
  });

  it('refuses a used-up coupon, and a cancelled or expired booking frees its use', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await createCoupon({ code: 'ONCE', type: 'fixed', value: 100, maxUses: 1 });
    const first = await post(`${base()}/bookings`, { date: D, startAts: [at('18:00')], couponCode: 'ONCE' }, a.token);
    expect(first.status).toBe(201);
    const second = await post(`${base()}/bookings`, { date: D, startAts: [at('19:00')], couponCode: 'ONCE' }, b.token);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('coupon_used_up');
    await Booking.updateOne({ ownerId, _id: first.body.booking.id }, { $set: { status: 'cancelled' } });
    expect((await post(`${base()}/bookings`, { date: D, startAts: [at('19:00')], couponCode: 'ONCE' }, b.token)).status).toBe(201);
  });

  it('a lapsed payment hold frees its use', async () => {
    await setup({ paymentPolicy: { type: 'full' } });
    const a = await newPlayer();
    await createCoupon({ code: 'ONCE', type: 'percent', value: 10, maxUses: 1 });
    const held = await post(`${base()}/bookings`, { date: D, startAts: [at('18:00')], couponCode: 'ONCE' }, a.token);
    expect(held.body.booking.status).toBe('awaiting_payment');
    expect((await quote('ONCE', ['19:00'])).body.error.code).toBe('coupon_used_up');
    ctx.services.clock.advance(20 * 60_000);
    expect((await quote('ONCE', ['19:00'])).status).toBe(200);
  });

  it('limits uses per player, on the quote when signed in and on the booking', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await createCoupon({ code: 'MINE', type: 'fixed', value: 100, maxUsesPerCustomer: 1 });
    expect((await post(`${base()}/bookings`, { date: D, startAts: [at('18:00')], couponCode: 'MINE' }, a.token)).status).toBe(201);
    expect((await quote('MINE', ['19:00'], a.token)).body.error.code).toBe('coupon_limit_reached');
    const again = await post(`${base()}/bookings`, { date: D, startAts: [at('19:00')], couponCode: 'MINE' }, a.token);
    expect(again.body.error.code).toBe('coupon_limit_reached');
    expect((await post(`${base()}/bookings`, { date: D, startAts: [at('19:00')], couponCode: 'MINE' }, b.token)).status).toBe(201);
  });

  it('a group splits one discount across its bookings and counts as one use', async () => {
    const { token } = await newPlayer();
    await createCoupon({ code: 'GROUP', type: 'fixed', value: 1000, maxUses: 1 });
    const body = { date: D, startAts: [at('18:00')], more: [{ date: D, startAts: [at('20:00'), at('21:00')] }], couponCode: 'GROUP' };
    const q = await post(`${base()}/quote`, body, token);
    expect(q.status).toBe(200);
    expect(q.body.coupon.discount).toBe(1000);
    expect(q.body.total).toBe(4500 - 1000);
    expect(q.body.items.map((i: { quote: { discount: number } }) => i.quote.discount)).toEqual([334, 666]);
    const res = await post(`${base()}/bookings`, body, token);
    expect(res.status).toBe(201);
    expect(res.body.bookings.map((b: { coupon: { discount: number } }) => b.coupon.discount)).toEqual([334, 666]);
    const list = await request(ctx.app).get(ownerPath()).set(...bearer(ownerToken));
    expect(list.body.coupons[0].uses).toBe(1);
  });
});
