import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { bearer, seedOwner, seedUser } from '../helpers/tenancy';
import { signedEvent } from '../helpers/stripe';
import { signAccessToken } from '../../src/auth/jwt';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Booking } from '../../src/bookings/booking.model';
import { PlatformLog } from '../../src/admin/platformLog.model';
import { PlatformSettings, clearSettingsCache } from '../../src/admin/settings';
import { PlatformPayout } from '../../src/platform/payout.model';
import { PlatformWebhookEvent } from '../../src/platform/webhookEvent.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Booking.init(), PlatformLog.init(),
    PlatformPayout.init(), PlatformWebhookEvent.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const oid = () => new mongoose.Types.ObjectId();
const cross = { crossTenant: true };
const HOUR = 3_600_000;
const TEST_KEYS = { mode: 'test', secretKey: 'sk_test_payout1', publishableKey: 'pk_test_payout1', webhookSecret: 'whsec_payout1', enabled: true };
const LIVE_KEYS = { mode: 'live', secretKey: 'sk_live_payout2', publishableKey: 'pk_live_payout2', webhookSecret: 'whsec_payout2', enabled: true };

let ctx: ReturnType<typeof buildTestApp>;
let admin: Awaited<ReturnType<typeof seedUser>>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let seq = 0;

const api = (path: string) => `/api/v1${path}`;
const get = (path: string, token = a.token) => request(ctx.app).get(api(path)).set(...bearer(token));
const post = (path: string, body: object = {}, token = a.token) => request(ctx.app).post(api(path)).set(...bearer(token)).send(body);
const put = (path: string, body: object, token = admin.token) => request(ctx.app).put(api(path)).set(...bearer(token)).send(body);
const start = (body: object = {}) => post(`/owners/${a.ownerId}/platform-payouts/stripe`, { currency: 'BDT', amount: 6000, ...body });
const bdt = async () =>
  (await get(`/owners/${a.ownerId}/platform-fee`)).body.balances.find((b: { currency: string }) => b.currency === 'BDT');
/** Moves the clock on; the owner's access token is signed again, since it would have expired. */
async function advance(ms: number) {
  ctx.services.clock.advance(ms);
  a = { ...a, token: await signAccessToken(a.userId, ctx.config.jwtSecret, ctx.services.now()) };
}
const payoutOf = async (id: string) => (await PlatformPayout.findById(id).setOptions(cross).lean())!;
/** Starts a payout; returns it with the PaymentIntent id stored for it. */
async function started(body: object = {}): Promise<PayoutLike> {
  const res = await start(body);
  expect(res.status).toBe(201);
  const { payout } = res.body;
  return { ...payout, pi: (await payoutOf(payout.id)).stripePaymentIntentId };
}

async function setGeneral() {
  await PlatformSettings.updateOne(
    { _id: 'platform' },
    {
      $set: {
        general: {
          ownerApproval: 'manual',
          fee: { mode: 'fixed', fixed: 50, percent: null, payer: 'owner' },
          payout: { bkash: { provider: 'bkash', number: '01712345678', accountType: 'personal' }, nagad: null, stripe: null },
        },
      },
    },
    { upsert: true },
  );
  clearSettingsCache();
}

async function connectAdminStripe(keys: object = TEST_KEYS) {
  const res = await put('/admin/settings/payout-stripe', keys);
  expect(res.status).toBe(200);
  clearSettingsCache();
}

/** Two owing bookings of 5000 fee each: 10000 BDT owed. */
async function owing() {
  for (let i = 0; i < 2; i++) {
    seq += 1;
    const startAt = new Date(ctx.services.now().getTime() + 86_400_000);
    const endAt = new Date(startAt.getTime() + HOUR);
    await Booking.create({
      ownerId: a.ownerId, venueId: oid(), turfId: oid(), reference: `SPAY${seq}`, businessDate: '2026-01-01',
      startAt, endAt, slots: [{ startAt, endAt, price: 100000 }], currency: 'BDT', subtotal: 100000, addonsTotal: 0,
      total: 100000, advanceRequired: 0, status: 'confirmed', paymentStatus: 'unpaid', source: 'online', policySnapshot: {},
      platformFee: { mode: 'fixed', value: 50, payer: 'owner', amount: 5000 },
    });
  }
}

let eventSeq = 0;
type PayoutLike = { id: string; amount: number; currency: string; pi?: string | null };
function payoutEvent(
  type: string,
  p: PayoutLike,
  o: { id?: string; amount?: number; currency?: string; pi?: string; livemode?: boolean } = {},
) {
  eventSeq += 1;
  return {
    id: o.id ?? `evt_payout_${eventSeq}`,
    object: 'event',
    type,
    livemode: o.livemode ?? false,
    data: {
      object: {
        id: o.pi ?? p.pi ?? `pi_for_${p.id}`,
        object: 'payment_intent',
        amount: p.amount,
        amount_received: type === 'payment_intent.succeeded' ? (o.amount ?? p.amount) : 0,
        currency: (o.currency ?? p.currency).toLowerCase(),
        metadata: { payoutId: p.id },
        ...(type === 'payment_intent.payment_failed' ? { last_payment_error: { code: 'card_declined' } } : {}),
      },
    },
  };
}

function postPlatform(event: object, secret = TEST_KEYS.webhookSecret) {
  const { body, signature } = signedEvent(secret, event);
  return request(ctx.app)
    .post(api('/webhooks/stripe/platform'))
    .set('stripe-signature', signature)
    .set('Content-Type', 'application/json')
    .send(body);
}

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    PlatformLog.deleteMany({}),
    PlatformSettings.deleteMany({}),
    PlatformWebhookEvent.deleteMany({}),
    ...[Membership, ActivityLog, Booking, PlatformPayout].map((m) => (m as typeof Booking).deleteMany({}).setOptions(cross)),
  ]);
  clearSettingsCache();
  ctx = buildTestApp();
  admin = await seedUser(ctx.services, { name: 'Admin', platformAdmin: true });
  a = await seedOwner(ctx.services, { name: 'Arena' });
  await setGeneral();
  await connectAdminStripe();
  await owing();
});

describe('start a Stripe payout', () => {
  it('start stripe payout returns a client secret', async () => {
    const res = await start();
    expect(res.status).toBe(201);
    expect(res.body.payout).toMatchObject({ ownerId: a.ownerId, currency: 'BDT', amount: 6000, method: 'stripe', status: 'pending', trxId: null });
    const call = ctx.services.stripe.calls.find((c) => c.method === 'paymentIntents.create')!;
    expect(call.secretKey).toBe('sk_test_payout1');
    expect(call.idempotencyKey).toBe(`payout-${res.body.payout.id}`);
    expect(call.params).toMatchObject({ amount: 6000, currency: 'bdt', metadata: { payoutId: res.body.payout.id } });
    expect(res.body.clientSecret).toBe('pi_test_1_secret_x');
    expect(res.body.publishableKey).toBe('pk_test_payout1');
    expect((await payoutOf(res.body.payout.id)).stripePaymentIntentId).toBe('pi_test_1');
    expect(await bdt()).toMatchObject({ owed: 10000, paid: 0, pending: 6000, balance: 10000, payable: 4000 });
  });

  it('checks the amount against what can be paid', async () => {
    expect((await start({ amount: 10001 })).body.error.code).toBe('amount_exceeds_balance');
    expect((await start({ amount: 0 })).body.error.code).toBe('amount_exceeds_balance');
    expect((await start()).status).toBe(201);
    expect((await start({ amount: 4001 })).body.error.code).toBe('amount_exceeds_balance');
    expect((await start({ amount: 4000 })).status).toBe(201);
    expect((await start({ currency: 'bdt' })).status).toBe(400);
  });

  it('no admin stripe → 400 method_unavailable', async () => {
    await request(ctx.app).delete(api('/admin/settings/payout-stripe')).set(...bearer(admin.token));
    clearSettingsCache();
    const res = await start();
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('method_unavailable');
    expect(await PlatformPayout.countDocuments({ ownerId: a.ownerId })).toBe(0);
  });

  it('a currency the gateway cannot charge → 400 method_unavailable', async () => {
    const res = await start({ currency: 'ISK', amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('method_unavailable');
  });

  it('a Stripe failure rejects the payout and frees the amount', async () => {
    ctx.services.stripe.fail('paymentIntents.create', 'api');
    const res = await start();
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('gateway_error');
    const [row] = await PlatformPayout.find({ ownerId: a.ownerId }).lean();
    expect(row).toMatchObject({ status: 'rejected', rejectReason: 'stripe_failed', method: 'stripe' });
    expect(await bdt()).toMatchObject({ pending: 0, payable: 10000 });
  });

  it('a Stripe failure stamps reviewedAt on the rejected payout', async () => {
    ctx.services.stripe.fail('paymentIntents.create', 'api');
    expect((await start()).status).toBe(502);
    const [row] = await PlatformPayout.find({ ownerId: a.ownerId }).lean();
    expect(row!.reviewedAt).toEqual(ctx.services.now());
  });

  it('an intent without a client secret rejects the payout', async () => {
    const real = ctx.services.stripe;
    ctx.services.stripe = Object.assign((key: string) => {
      const api = real(key);
      return { ...api, paymentIntents: { ...api.paymentIntents, create: async () => ({ id: 'pi_no_secret', client_secret: null }) } };
    }, real);
    const res = await start();
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('gateway_error');
    const [row] = await PlatformPayout.find({ ownerId: a.ownerId }).lean();
    expect(row).toMatchObject({ status: 'rejected', rejectReason: 'stripe_failed', stripePaymentIntentId: null });
    expect(await bdt()).toMatchObject({ pending: 0, payable: 10000 });
  });

  it('keeps the gateway error when marking the payout rejected fails too', async () => {
    ctx.services.stripe.fail('paymentIntents.create', 'api');
    const spy = vi.spyOn(PlatformPayout, 'updateOne').mockRejectedValueOnce(new Error('db down'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await start();
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('gateway_error');
    } finally {
      spy.mockRestore();
      quiet.mockRestore();
    }
  });

  it('a pending Stripe payout stops holding the amount after an hour', async () => {
    await start();
    await advance(HOUR - 1000);
    expect(await bdt()).toMatchObject({ pending: 6000, payable: 4000 });
    await advance(2000);
    expect(await bdt()).toMatchObject({ pending: 0, payable: 10000 });
  });
});

describe('POST /webhooks/stripe/platform', () => {
  it('webhook confirms the payout', async () => {
    const payout = await started();
    const event = payoutEvent('payment_intent.succeeded', payout);
    const res = await postPlatform(event);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect((await payoutOf(payout.id)).status).toBe('confirmed');
    expect(await bdt()).toMatchObject({ owed: 10000, paid: 6000, pending: 0, balance: 4000, payable: 4000 });
    const rows = await PlatformWebhookEvent.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventId: event.id, type: 'payment_intent.succeeded', outcome: 'applied' });
  });

  it('duplicate webhook is ignored', async () => {
    const payout = await started();
    const event = payoutEvent('payment_intent.succeeded', payout);
    expect((await postPlatform(event)).status).toBe(200);
    expect((await postPlatform(event)).status).toBe(200);
    expect(await PlatformWebhookEvent.countDocuments({})).toBe(1);
    expect(await bdt()).toMatchObject({ paid: 6000, balance: 4000 });
    // A different event for the same payout cannot confirm it twice either.
    expect((await postPlatform(payoutEvent('payment_intent.succeeded', payout))).status).toBe(200);
    expect(await bdt()).toMatchObject({ paid: 6000, balance: 4000 });
  });

  it('amount mismatch leaves it pending', async () => {
    const payout = await started();
    expect((await postPlatform(payoutEvent('payment_intent.succeeded', payout, { amount: 5999 }))).status).toBe(200);
    expect((await postPlatform(payoutEvent('payment_intent.succeeded', payout, { currency: 'USD' }))).status).toBe(200);
    expect((await payoutOf(payout.id)).status).toBe('pending');
    const outcomes = (await PlatformWebhookEvent.find({}).lean()).map((e) => e.outcome);
    expect(outcomes).toEqual(['mismatch', 'mismatch']);
    expect(await bdt()).toMatchObject({ paid: 0, pending: 6000 });
  });

  it('a failed or canceled intent rejects the payout', async () => {
    const one = await started({ amount: 3000 });
    const two = await started({ amount: 3000 });
    expect((await postPlatform(payoutEvent('payment_intent.payment_failed', one))).status).toBe(200);
    expect((await postPlatform(payoutEvent('payment_intent.canceled', two))).status).toBe(200);
    for (const p of [one, two]) expect(await payoutOf(p.id)).toMatchObject({ status: 'rejected', rejectReason: 'stripe_failed' });
    expect(await bdt()).toMatchObject({ pending: 0, payable: 10000 });
  });

  it('a late success still confirms an expired payout', async () => {
    const payout = await started();
    await advance(2 * HOUR);
    expect(await bdt()).toMatchObject({ pending: 0, payable: 10000 });
    expect((await postPlatform(payoutEvent('payment_intent.succeeded', payout))).status).toBe(200);
    expect((await payoutOf(payout.id)).status).toBe('confirmed');
    expect(await bdt()).toMatchObject({ paid: 6000, balance: 4000 });
  });

  it('verifies with each saved secret; a live payout takes live events only', async () => {
    // Both key sets saved, live active: the live payout is made with the live key.
    await connectAdminStripe(LIVE_KEYS);
    const payout = await started();
    const call = ctx.services.stripe.calls.filter((c) => c.method === 'paymentIntents.create').at(-1)!;
    expect(call.secretKey).toBe(LIVE_KEYS.secretKey);
    expect((await payoutOf(payout.id)).stripeMode).toBe('live');
    expect((await postPlatform(payoutEvent('payment_intent.succeeded', payout, { livemode: true }), 'whsec_wrong')).status).toBe(400);
    // Signed with the test secret (first in the loop) and test mode: verified, but it cannot settle a live payout.
    expect((await postPlatform(payoutEvent('payment_intent.succeeded', payout), TEST_KEYS.webhookSecret)).status).toBe(200);
    expect((await payoutOf(payout.id)).status).toBe('pending');
    // Signed with the live secret (second in the loop) and live mode: confirms.
    expect((await postPlatform(payoutEvent('payment_intent.succeeded', payout, { livemode: true }), LIVE_KEYS.webhookSecret)).status).toBe(200);
    expect((await payoutOf(payout.id)).status).toBe('confirmed');
    const outcomes = (await PlatformWebhookEvent.find({}).sort({ _id: 1 }).lean()).map((e) => e.outcome);
    expect(outcomes).toEqual(['unmatched', 'applied']);
  });

  it('a test-mode event cannot confirm or reject a live payout', async () => {
    await connectAdminStripe(LIVE_KEYS);
    const payout = await started();
    for (const type of ['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled']) {
      expect((await postPlatform(payoutEvent(type, payout, { livemode: false }), LIVE_KEYS.webhookSecret)).status).toBe(200);
    }
    expect(await payoutOf(payout.id)).toMatchObject({ status: 'pending', stripePaymentIntentId: payout.pi, reviewedAt: null });
  });

  it('a live-mode event cannot settle a test payout', async () => {
    const payout = await started();
    expect((await payoutOf(payout.id)).stripeMode).toBe('test');
    expect((await postPlatform(payoutEvent('payment_intent.succeeded', payout, { livemode: true }))).status).toBe(200);
    expect((await payoutOf(payout.id)).status).toBe('pending');
  });

  it('an event for another PaymentIntent is ignored and does not overwrite the stored one', async () => {
    const payout = await started();
    for (const type of ['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled']) {
      expect((await postPlatform(payoutEvent(type, payout, { pi: 'pi_someone_else' }))).status).toBe(200);
    }
    expect(await payoutOf(payout.id)).toMatchObject({ status: 'pending', stripePaymentIntentId: payout.pi });
    expect((await PlatformWebhookEvent.find({}).lean()).map((e) => e.outcome)).toEqual(['unmatched', 'unmatched', 'unmatched']);
    expect(await bdt()).toMatchObject({ paid: 0, pending: 6000 });
  });

  it('a payout whose intent was never stored is not settled by any event', async () => {
    ctx.services.stripe.fail('paymentIntents.create', 'api');
    expect((await start()).status).toBe(502);
    const [row] = await PlatformPayout.find({ ownerId: a.ownerId }).lean();
    expect(row!.stripePaymentIntentId).toBeNull();
    const p = { id: String(row!._id), amount: row!.amount, currency: row!.currency };
    expect((await postPlatform(payoutEvent('payment_intent.succeeded', p))).status).toBe(200);
    expect((await payoutOf(p.id)).status).toBe('rejected');
    expect(await bdt()).toMatchObject({ paid: 0, payable: 10000 });
  });

  it('a success after a failed attempt confirms the payout', async () => {
    const payout = await started();
    expect((await postPlatform(payoutEvent('payment_intent.payment_failed', payout))).status).toBe(200);
    expect(await payoutOf(payout.id)).toMatchObject({ status: 'rejected', rejectReason: 'stripe_failed' });
    expect((await postPlatform(payoutEvent('payment_intent.succeeded', payout))).status).toBe(200);
    expect(await payoutOf(payout.id)).toMatchObject({ status: 'confirmed', rejectReason: null });
    expect(await bdt()).toMatchObject({ paid: 6000, pending: 0, balance: 4000 });
  });

  it('confirms while the admin has switched Stripe off', async () => {
    const payout = await started();
    await connectAdminStripe({ ...TEST_KEYS, enabled: false });
    expect((await start()).body.error.code).toBe('method_unavailable');
    expect((await postPlatform(payoutEvent('payment_intent.succeeded', payout))).status).toBe(200);
    expect((await payoutOf(payout.id)).status).toBe('confirmed');
  });

  it('an event for no payout is recorded as unmatched', async () => {
    const res = await postPlatform(payoutEvent('payment_intent.succeeded', { id: String(oid()), amount: 100, currency: 'BDT' }));
    expect(res.status).toBe(200);
    expect((await PlatformWebhookEvent.findOne({}).lean())!.outcome).toBe('unmatched');
  });

  it('404 when the admin has no Stripe keys', async () => {
    await request(ctx.app).delete(api('/admin/settings/payout-stripe')).set(...bearer(admin.token));
    clearSettingsCache();
    const res = await postPlatform(payoutEvent('payment_intent.succeeded', { id: String(oid()), amount: 100, currency: 'BDT' }));
    expect(res.status).toBe(404);
  });
});

describe('admin queue and Stripe payouts', () => {
  it('lists manual payouts only, and refuses manual review of a Stripe payout', async () => {
    const payout = await started();
    expect((await get('/admin/payouts', admin.token)).body.payouts).toHaveLength(0);
    const all = await get('/admin/payouts?status=all', admin.token);
    expect(all.body.payouts.map((p: { id: string }) => p.id)).toEqual([payout.id]);
    for (const path of ['confirm', 'reject']) {
      const res = await post(`/admin/payouts/${payout.id}/${path}`, { reason: 'x' }, admin.token);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('payout_not_manual');
    }
    expect((await payoutOf(payout.id)).status).toBe('pending');
  });
});
