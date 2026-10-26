import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { signAccessToken } from '../../src/auth/jwt';
import { seedOwner, bearer } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { connectStripe } from '../helpers/stripe';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Booking } from '../../src/bookings/booking.model';
import { SlotLock } from '../../src/bookings/slotLock.model';
import { Payment } from '../../src/bookings/payment.model';
import { PaymentGatewayAccount } from '../../src/payments/gateway.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init(), Turf.init(),
    Booking.init(), SlotLock.init(), Payment.init(), PaymentGatewayAccount.init(),
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
let owner: Awaited<ReturnType<typeof seedOwner>>;
let slug: string;
let turfId: string;
let player: { userId: string; token: string };

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[Venue, Turf, Booking, SlotLock, Payment, PaymentGatewayAccount].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions({ crossTenant: true }),
    ),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
  player = await newPlayer();
});

async function newPlayer() {
  const u = await User.create({ name: 'Player', email: `p${Math.random()}@test.local` });
  return { userId: u.id as string, token: await signAccessToken(u.id as string, ctx.config.jwtSecret, ctx.services.now()) };
}

async function setup(paymentPolicy: Record<string, unknown>, over: { currency?: string } = {}) {
  const venue = await seedVenue(owner.ownerId, {
    published: true,
    slug: `arena-${Math.random().toString(36).slice(2, 8)}`,
    timezone: TZ,
    ...(over.currency ? { currency: over.currency } : {}),
    settings: { hours: HOURS, bookingWindowDays: 365, paymentPolicy },
  });
  const turf = await seedTurf(owner.ownerId, venue.id as string, { pricing: { base: 3000, rules: [] } });
  slug = venue.slug;
  turfId = turf.id as string;
}

const hold = async (token = player.token, hm = '18:00') => {
  const res = await request(ctx.app)
    .post(`/api/v1/venues/${slug}/turfs/${turfId}/bookings`)
    .set(...bearer(token))
    .send({ date: D, startAts: [at(hm)] });
  expect(res.status).toBe(201);
  return res.body.booking as { id: string; reference: string; status: string };
};
const pay = (id: string, token = player.token) =>
  request(ctx.app).post(`/api/v1/bookings/${id}/payment`).set(...bearer(token)).send({});

const partial = { type: 'partial_percent', percent: 20 };

describe('switching Stripe accounts', () => {
  const switchTo = (secretKey: string) =>
    request(ctx.app)
      .put(`/api/v1/owners/${owner.ownerId}/payment-gateways/stripe`)
      .set(...bearer(owner.token))
      .send({ secretKey, publishableKey: 'pk_test_new', webhookSecret: 'whsec_new' });
  const cancels = () => ctx.services.stripe.calls.filter((c) => c.method === 'paymentIntents.cancel');
  const accountNow = async () => (await PaymentGatewayAccount.findOne({ ownerId: owner.ownerId }))!.keys!.test!.accountId;
  const paymentNow = async () => (await Payment.findOne({ ownerId: owner.ownerId }))!;

  it("cancels a lapsed hold's intent on the old account, fails the payment and switches", async () => {
    await setup(partial);
    await connectStripe(ctx.app, owner, { secretKey: 'sk_test_first1' });
    const b = await hold();
    expect((await pay(b.id)).status).toBe(200);
    ctx.services.clock.advance(10 * 60_000);

    const res = await switchTo('sk_test_second');
    expect(res.status).toBe(200);
    expect(res.body.gateway.accounts.test.accountId).toBe('acct_test_second');
    expect(await accountNow()).toBe('acct_test_second');
    expect(cancels()).toEqual([{ method: 'paymentIntents.cancel', secretKey: 'sk_test_first1', params: { id: 'pi_test_1' } }]);
    expect(ctx.services.stripe.statusOf('pi_test_1')).toBe('canceled');
    expect(await paymentNow()).toMatchObject({ status: 'failed', failureCode: 'account_switched' });
  });

  it('409 gateway_account_in_use while a live hold is paying on the old account', async () => {
    await setup(partial);
    const { accountId } = await connectStripe(ctx.app, owner, { secretKey: 'sk_test_first1' });
    const b = await hold();
    expect((await pay(b.id)).status).toBe(200);

    const res = await switchTo('sk_test_second');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('gateway_account_in_use');
    expect(cancels()).toHaveLength(0);
    expect(await accountNow()).toBe(accountId);
    expect(await paymentNow()).toMatchObject({ status: 'pending', failureCode: null });
  });

  it('409 and no switch when the lapsed intent already succeeded at Stripe', async () => {
    await setup(partial);
    const { accountId } = await connectStripe(ctx.app, owner, { secretKey: 'sk_test_first1' });
    const b = await hold();
    expect((await pay(b.id)).status).toBe(200);
    ctx.services.stripe.settle('pi_test_1', 'succeeded');
    ctx.services.clock.advance(10 * 60_000);

    const res = await switchTo('sk_test_second');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('gateway_account_in_use');
    expect(cancels()).toHaveLength(1);
    expect(await accountNow()).toBe(accountId);
    expect(await paymentNow()).toMatchObject({ status: 'pending' });
  });
});

describe('POST /bookings/:id/payment', () => {
  it('creates a PaymentIntent for the advance', async () => {
    await setup(partial);
    const { accountId } = await connectStripe(ctx.app, owner);
    const b = await hold();
    const res = await pay(b.id);
    expect(res.status).toBe(200);
    expect(res.body.payment).toMatchObject({
      amount: 600,
      currency: 'BDT',
      gateway: 'stripe',
      clientSecret: 'pi_test_1_secret_x',
      publishableKey: expect.stringMatching(/^pk_test_/),
    });
    expect(res.body.holdExpiresAt).toEqual(expect.any(String));
    const rows = await Payment.find({}).setOptions({ crossTenant: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      method: 'card', kind: 'intent', status: 'pending', gateway: 'stripe',
      gatewayAccountId: accountId, gatewayRef: 'pi_test_1',
    });
    const call = ctx.services.stripe.calls.find((c) => c.method === 'paymentIntents.create')!;
    expect(call.params).toMatchObject({
      amount: 600,
      currency: 'bdt',
      metadata: {
        paymentId: String(rows[0]!._id),
        bookingId: b.id,
        ownerId: owner.ownerId,
        reference: b.reference,
      },
    });
  });

  it('returns the same client secret on a repeat and under concurrency', async () => {
    await setup(partial);
    await connectStripe(ctx.app, owner);
    const b = await hold();
    const first = await pay(b.id);
    const [second, third] = await Promise.all([pay(b.id), pay(b.id)]);
    for (const r of [second, third]) {
      expect(r.status).toBe(200);
      expect(r.body.payment.clientSecret).toBe(first.body.payment.clientSecret);
      expect(r.body.payment.id).toBe(first.body.payment.id);
    }
    expect(await Payment.countDocuments({}).setOptions({ crossTenant: true })).toBe(1);
  });

  it('handles two concurrent first calls', async () => {
    await setup(partial);
    await connectStripe(ctx.app, owner);
    const b = await hold();
    const [a, c] = await Promise.all([pay(b.id), pay(b.id)]);
    expect([a.status, c.status]).toEqual([200, 200]);
    expect(a.body.payment.clientSecret).toBe(c.body.payment.clientSecret);
    expect(await Payment.countDocuments({}).setOptions({ crossTenant: true })).toBe(1);
  });

  it('expires a lapsed hold', async () => {
    await setup(partial);
    await connectStripe(ctx.app, owner);
    const b = await hold();
    ctx.services.clock.advance(10 * 60_000);
    const res = await pay(b.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('hold_expired');
    const stored = await Booking.findById(b.id).setOptions({ crossTenant: true });
    expect(stored!.status).toBe('expired');
    expect(await SlotLock.countDocuments({}).setOptions({ crossTenant: true })).toBe(0);
    expect(ctx.services.stripe.calls.filter((c) => c.method === 'paymentIntents.create')).toHaveLength(0);
  });

  it('hides other players bookings and malformed ids behind the same 404', async () => {
    await setup(partial);
    await connectStripe(ctx.app, owner);
    const b = await hold();
    const other = await newPlayer();
    const foreign = await pay(b.id, other.token);
    const malformed = await pay('nope');
    expect(foreign.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(foreign.body).toEqual(malformed.body);
    expect(foreign.body.error.message).toBe('Booking not found');
  });

  it('rejects a booking that is not awaiting payment', async () => {
    await setup({ type: 'none' });
    await connectStripe(ctx.app, owner);
    const b = await hold();
    expect(b.status).toBe('confirmed');
    const res = await pay(b.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('invalid_transition');
  });

  it('is unavailable when the gateway is disabled, not connected, or the currency unsupported', async () => {
    await setup(partial);
    await connectStripe(ctx.app, owner, { enabled: false });
    const b = await hold();
    expect((await pay(b.id)).body.error.code).toBe('payments_unavailable');
    expect((await pay(b.id)).status).toBe(409);

    await PaymentGatewayAccount.deleteMany({}).setOptions({ crossTenant: true });
    expect((await pay(b.id)).body.error.code).toBe('payments_unavailable');

    await connectStripe(ctx.app, owner);
    await setup(partial, { currency: 'KWD' });
    const kwd = await hold(player.token, '19:00');
    const res = await pay(kwd.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('payments_unavailable');
    expect(await Payment.countDocuments({}).setOptions({ crossTenant: true })).toBe(0);
  });

  it('keeps the pending row after a Stripe error and reuses it on retry', async () => {
    await setup(partial);
    await connectStripe(ctx.app, owner);
    const b = await hold();
    ctx.services.stripe.fail('paymentIntents.create', 'api');
    const failed = await pay(b.id);
    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe('gateway_error');
    const rows = await Payment.find({}).setOptions({ crossTenant: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.gatewayRef).toBeNull();
    const retry = await pay(b.id);
    expect(retry.status).toBe(200);
    expect(retry.body.payment.id).toBe(String(rows[0]!._id));
    expect(await Payment.countDocuments({}).setOptions({ crossTenant: true })).toBe(1);
  });
});
