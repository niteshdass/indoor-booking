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
import { WebhookEvent } from '../../src/payments/webhookEvent.model';
import { Refund } from '../../src/payments/refund.model';
import { GatewayError } from '../../src/payments/gateway';
import { sslcommerzGateway, toDecimal } from '../../src/payments/sslcommerz';
import { reconcileHostedPayments, CLOSE_AFTER_MINUTES, LOOKUP_AFTER_MINUTES } from '../../src/payments/hosted';
import { reconcileRefunds } from '../../src/payments/refunds';
import { makeFakeSslcommerz } from '../helpers/testServices';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init(), Turf.init(),
    Booking.init(), SlotLock.init(), Payment.init(), PaymentGatewayAccount.init(), WebhookEvent.init(), Refund.init(),
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
const partial = { type: 'partial_percent', percent: 20 };

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let slug: string;
let turfId: string;
let player: { userId: string; token: string };

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[Venue, Turf, Booking, SlotLock, Payment, PaymentGatewayAccount, WebhookEvent, Refund].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions({ crossTenant: true }),
    ),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
  const u = await User.create({ name: 'Rahim', email: 'rahim@test.local', phone: '+8801711111111' });
  player = { userId: u.id as string, token: await signAccessToken(u.id as string, ctx.config.jwtSecret, ctx.services.now()) };
});

const fake = () => ctx.services.sslcommerz;

async function setup(gateways: ('stripe' | 'sslcommerz')[] = ['sslcommerz']) {
  const venue = await seedVenue(owner.ownerId, {
    published: true,
    slug: `arena-${Math.random().toString(36).slice(2, 8)}`,
    timezone: TZ,
    settings: { hours: HOURS, bookingWindowDays: 365, paymentPolicy: partial, paymentMethods: { manualWallets: [], gateways } },
  });
  const turf = await seedTurf(owner.ownerId, venue.id as string, { pricing: { base: 3000, rules: [] } });
  slug = venue.slug;
  turfId = turf.id as string;
}

const connect = (body: Record<string, unknown> = {}) =>
  request(ctx.app)
    .put(`/api/v1/owners/${owner.ownerId}/payment-gateways/sslcommerz`)
    .set(...bearer(owner.token))
    .send({ storeId: 'arena01', storePassword: 'secret@ssl', mode: 'test', ...body });

const hold = async () => {
  const res = await request(ctx.app)
    .post(`/api/v1/venues/${slug}/turfs/${turfId}/bookings`)
    .set(...bearer(player.token))
    .send({ date: D, startAts: [at('18:00')] });
  expect(res.status).toBe(201);
  return res.body.booking as { id: string; reference: string };
};
const pay = (id: string, gateway?: string) =>
  request(ctx.app).post(`/api/v1/bookings/${id}/payment`).set(...bearer(player.token)).send(gateway ? { gateway } : {});

const ipn = (form: Record<string, string>) =>
  request(ctx.app).post(`/api/v1/webhooks/sslcommerz/${owner.ownerId}`).type('form').send(form);
const back = (bookingId: string, result: string, form: Record<string, string>) =>
  request(ctx.app)
    .post(`/api/v1/webhooks/sslcommerz/${owner.ownerId}/return?booking=${bookingId}&result=${result}`)
    .type('form')
    .send(form);

/** A booking whose SSLCommerz session is open; returns its payment id (the tran_id). */
async function openSession() {
  await setup();
  expect((await connect()).status).toBe(200);
  const b = await hold();
  const res = await pay(b.id, 'sslcommerz');
  expect(res.status).toBe(200);
  const p = (await Payment.findOne({ bookingId: b.id }).setOptions({ crossTenant: true }))!;
  return { booking: b, tranId: String(p._id), res };
}

describe('adapter', () => {
  const creds = { storeId: 'arena01', storePassword: 'secret@ssl', live: false };

  it('supports BDT in Bangladesh only', () => {
    const gw = sslcommerzGateway(makeFakeSslcommerz());
    expect(gw.supports('BD', 'BDT')).toBe(true);
    expect(gw.supports('BD', 'USD')).toBe(false);
    expect(gw.supports('US', 'BDT')).toBe(false);
  });

  it('writes amounts as decimals', () => {
    expect(toDecimal(150000, 'BDT')).toBe('1500.00');
    expect(toDecimal(5, 'BDT')).toBe('0.05');
  });

  it('verifies credentials with the store and refuses bad ones', async () => {
    const gw = sslcommerzGateway(makeFakeSslcommerz());
    expect(await gw.verifyCredentials(creds)).toEqual({ accountId: 'arena01' });
    await expect(gw.verifyCredentials({ ...creds, storePassword: 'bad' })).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('uses the sandbox or the live host by mode', async () => {
    const http = makeFakeSslcommerz();
    const gw = sslcommerzGateway(http);
    await gw.verifyCredentials(creds);
    await gw.verifyCredentials({ ...creds, live: true });
    expect(http.calls.map((c) => c.url.origin)).toEqual(['https://sandbox.sslcommerz.com', 'https://securepay.sslcommerz.com']);
  });

  it('wraps a timeout in a gateway_error', async () => {
    const http = makeFakeSslcommerz();
    http.fail('merchantTransIDvalidationAPI');
    const err = await sslcommerzGateway(http).verifyCredentials(creds).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err).toMatchObject({ code: 'gateway_error' });
  });

  it('refuses to cancel a paid session and looks refunds up only by reference', async () => {
    const http = makeFakeSslcommerz();
    const gw = sslcommerzGateway(http);
    const input = {
      kind: 'intent' as const, amount: 60000, currency: 'BDT', description: 'd', idempotencyKey: 'k',
      metadata: { paymentId: 'p1' }, returnUrl: 'https://api.test/r', notifyUrl: 'https://api.test/n',
    };
    await gw.createPayment(creds, input);
    await gw.cancelPayment(creds, { kind: 'intent', paymentId: 'p1', gatewayRef: null, linkRef: 'p1' });
    http.pay('p1');
    await expect(gw.cancelPayment(creds, { kind: 'intent', paymentId: 'p1', gatewayRef: null, linkRef: 'p1' })).rejects.toBeInstanceOf(GatewayError);
    await expect(gw.findRefund(creds, { gatewayRef: 'bank1', refundId: 'r1', refundRef: null })).rejects.toBeInstanceOf(GatewayError);
  });
});

describe('connecting', () => {
  it('connects with a store id and password and keeps the password out of the response', async () => {
    const res = await connect();
    expect(res.status).toBe(200);
    expect(res.body.gateway).toMatchObject({
      gateway: 'sslcommerz', connected: true, enabled: true, mode: 'test',
      accounts: { test: { accountId: 'arena01', publishableKey: null }, live: null },
    });
    expect(JSON.stringify(res.body)).not.toContain('secret@ssl');
  });

  it('rejects a refused store and malformed fields', async () => {
    expect((await connect({ storePassword: 'bad-password' })).body.error.code).toBe('invalid_credentials');
    expect((await connect({ storeId: 'has space' })).status).toBe(400);
    expect((await connect({ storePassword: 'two words' })).status).toBe(400);
    expect((await connect({ secretKey: 'sk_test_x' })).status).toBe(400);
  });
});

describe('payment options', () => {
  it('offers SSLCommerz once connected and switched on for the venue', async () => {
    await setup();
    const b = await hold();
    const options = () => request(ctx.app).get(`/api/v1/bookings/${b.id}/payment-options`).set(...bearer(player.token));
    expect((await options()).body).toMatchObject({ card: false, sslcommerz: false });
    await connect();
    expect((await options()).body).toMatchObject({ card: false, sslcommerz: true });
  });

  it('refuses SSLCommerz checkout when it is not offered', async () => {
    await setup(['stripe']);
    await connect();
    const b = await hold();
    expect((await pay(b.id, 'sslcommerz')).status).toBe(409);
  });
});

describe('checkout', () => {
  it('opens a session for the advance and returns its page', async () => {
    const { tranId, res, booking } = await openSession();
    expect(res.body.payment.gateway).toBe('sslcommerz');
    expect(res.body.payment.url).toMatch(/^https:\/\/sandbox\.sslcommerz\.com\/gwprocess\/v4\/pay\//);
    const [session] = fake().sessions;
    expect(session!.form).toMatchObject({
      tran_id: tranId,
      total_amount: toDecimal(res.body.payment.amount, 'BDT'),
      currency: 'BDT',
      cus_name: 'Rahim',
      cus_email: 'rahim@test.local',
      ipn_url: `${ctx.config.apiUrl}/api/v1/webhooks/sslcommerz/${owner.ownerId}`,
    });
    expect(session!.form.success_url).toContain(`/sslcommerz/${owner.ownerId}/return?booking=${booking.id}&result=success`);
    expect(await Payment.findById(tranId).setOptions({ crossTenant: true })).toMatchObject({
      gateway: 'sslcommerz', method: 'card', kind: 'intent', status: 'pending', linkRef: tranId, linkUrl: res.body.payment.url,
    });
  });

  it('reuses the open session, and opens a new one after a failed attempt', async () => {
    const { booking, tranId, res } = await openSession();
    expect((await pay(booking.id, 'sslcommerz')).body.payment.url).toBe(res.body.payment.url);
    expect(fake().sessions).toHaveLength(1);

    fake().attempt(tranId, 'FAILED');
    expect((await ipn({ tran_id: tranId, status: 'FAILED' })).status).toBe(200);
    expect((await Payment.findById(tranId).setOptions({ crossTenant: true }))!.failureCode).toBe('failed');
    const again = await pay(booking.id, 'sslcommerz');
    expect(again.body.payment.url).not.toBe(res.body.payment.url);
    expect(fake().sessions).toHaveLength(2);
    expect((await Payment.findById(tranId).setOptions({ crossTenant: true }))!.failureCode).toBeNull();
  });

  it('409 payment_in_progress when Stripe is asked for while a session is open', async () => {
    await setup(['stripe', 'sslcommerz']);
    await connect();
    await connectStripe(ctx.app, owner);
    const b = await hold();
    expect((await pay(b.id, 'sslcommerz')).status).toBe(200);
    const res = await pay(b.id, 'stripe');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('payment_in_progress');
  });

  it('cancels a Stripe intent to switch to SSLCommerz', async () => {
    await setup(['stripe', 'sslcommerz']);
    await connect();
    await connectStripe(ctx.app, owner);
    const b = await hold();
    expect((await pay(b.id)).body.payment.gateway).toBe('stripe');
    const res = await pay(b.id, 'sslcommerz');
    expect(res.status).toBe(200);
    expect(ctx.services.stripe.statusOf('pi_test_1')).toBe('canceled');
    const rows = await Payment.find({ bookingId: b.id }).setOptions({ crossTenant: true }).sort({ _id: 1 });
    expect(rows.map((p) => [p.gateway, p.status, p.failureCode])).toEqual([
      ['stripe', 'failed', 'superseded'],
      ['sslcommerz', 'pending', null],
    ]);
  });
});

describe('notifications', () => {
  it('confirms the booking on a validated notice, once', async () => {
    const { booking, tranId } = await openSession();
    const valId = fake().pay(tranId);
    expect((await ipn({ tran_id: tranId, val_id: valId, status: 'VALID' })).status).toBe(200);
    expect((await ipn({ tran_id: tranId, val_id: valId, status: 'VALID' })).status).toBe(200);
    expect(await Payment.findById(tranId).setOptions({ crossTenant: true })).toMatchObject({ status: 'succeeded', gatewayRef: expect.stringMatching(/^bank/) });
    expect((await Booking.findById(booking.id).setOptions({ crossTenant: true }))!.status).toBe('confirmed');
    expect(await WebhookEvent.countDocuments({ eventId: `val_${valId}` }).setOptions({ crossTenant: true })).toBe(1);
  });

  it('ignores a forged notice: unknown val_id, unknown tran_id, or VALID with no record', async () => {
    const { tranId } = await openSession();
    expect((await ipn({ tran_id: tranId, val_id: 'val_forged', status: 'VALID' })).status).toBe(400);
    expect((await ipn({ tran_id: 'nope', status: 'VALID' })).status).toBe(400);
    expect((await ipn({ tran_id: tranId, status: 'VALID' })).status).toBe(400);
    expect((await Payment.findById(tranId).setOptions({ crossTenant: true }))!.status).toBe('pending');
  });

  it('settles from the store record when the post claims a failure for a paid session', async () => {
    const { tranId } = await openSession();
    fake().pay(tranId);
    expect((await ipn({ tran_id: tranId, status: 'FAILED' })).status).toBe(200);
    expect((await Payment.findById(tranId).setOptions({ crossTenant: true }))!.status).toBe('succeeded');
  });

  it('fails and refunds a payment of the wrong amount', async () => {
    const { tranId } = await openSession();
    const valId = fake().pay(tranId, { amount: '1.00' });
    expect((await ipn({ tran_id: tranId, val_id: valId, status: 'VALID' })).status).toBe(200);
    expect(await Payment.findById(tranId).setOptions({ crossTenant: true })).toMatchObject({ status: 'failed', failureCode: 'amount_mismatch' });
    expect(await Refund.countDocuments({ paymentId: tranId }).setOptions({ crossTenant: true })).toBe(1);
  });

  it('404 for an owner without SSLCommerz', async () => {
    await setup();
    expect((await ipn({ tran_id: 'x', status: 'VALID' })).status).toBe(404);
  });
});

describe('return', () => {
  it('applies a paid return and sends the player to the booking', async () => {
    const { booking, tranId } = await openSession();
    const valId = fake().pay(tranId);
    const res = await back(booking.id, 'success', { tran_id: tranId, val_id: valId, status: 'VALID' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`${ctx.config.appUrl}/me/bookings/${booking.id}?paid=1`);
    expect((await Payment.findById(tranId).setOptions({ crossTenant: true }))!.status).toBe('succeeded');
  });

  it('sends a failed or cancelled return back to the pay page', async () => {
    const { booking, tranId } = await openSession();
    fake().attempt(tranId, 'CANCELLED');
    const cancelled = await back(booking.id, 'cancel', { tran_id: tranId, status: 'CANCELLED' });
    expect(cancelled.headers.location).toBe(`${ctx.config.appUrl}/me/bookings/${booking.id}/pay?payment=cancelled`);
    const failed = await back(booking.id, 'fail', { tran_id: 'forged', status: 'FAILED' });
    expect(failed.headers.location).toBe(`${ctx.config.appUrl}/me/bookings/${booking.id}/pay?payment=failed`);
  });

  it('never redirects to a booking of another owner', async () => {
    const { tranId } = await openSession();
    const res = await back('64b000000000000000000000', 'success', { tran_id: tranId, status: 'VALID' });
    expect(res.headers.location).toBe(`${ctx.config.appUrl}/me/bookings`);
  });
});

describe('reconcile sweep', () => {
  const minutes = (n: number) => ctx.services.clock.advance(n * 60_000);
  const sweep = () => reconcileHostedPayments(ctx.services.now(), { config: ctx.config, services: ctx.services });

  it('settles a paid session whose notice never came', async () => {
    const { booking, tranId } = await openSession();
    fake().pay(tranId);
    expect(await sweep()).toEqual({ settled: 0, closed: 0 });
    minutes(LOOKUP_AFTER_MINUTES);
    expect(await sweep()).toEqual({ settled: 1, closed: 0 });
    expect((await Booking.findById(booking.id).setOptions({ crossTenant: true }))!.status).toBe('confirmed');
  });

  it('closes a session nobody paid', async () => {
    const { tranId } = await openSession();
    minutes(LOOKUP_AFTER_MINUTES);
    expect(await sweep()).toEqual({ settled: 0, closed: 0 });
    minutes(CLOSE_AFTER_MINUTES);
    expect(await sweep()).toEqual({ settled: 0, closed: 1 });
    expect((await Payment.findById(tranId).setOptions({ crossTenant: true }))!.status).toBe('failed');
  });

  it('leaves a payment alone while the store cannot be reached', async () => {
    const { tranId } = await openSession();
    minutes(CLOSE_AFTER_MINUTES);
    fake().fail('merchantTransIDvalidationAPI');
    expect(await sweep()).toEqual({ settled: 0, closed: 0 });
    expect((await Payment.findById(tranId).setOptions({ crossTenant: true }))!.status).toBe('pending');
  });
});

describe('refunds', () => {
  it('sends a refund by bank_tran_id and settles it from the refund query', async () => {
    const { tranId } = await openSession();
    // A paid session with the wrong amount is refunded straight away.
    const valId = fake().pay(tranId, { amount: '1.00' });
    await ipn({ tran_id: tranId, val_id: valId, status: 'VALID' });
    // Sent once the notice is applied; SSLCommerz accepts it ('success') and pays out later.
    const refund = (await Refund.findOne({ paymentId: tranId }).setOptions({ crossTenant: true }))!;
    const sent = fake().calls.filter((c) => c.url.searchParams.has('refund_amount'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url.searchParams.get('bank_tran_id')).toMatch(/^bank/);
    expect(sent[0]!.url.searchParams.get('refund_amount')).toBe('1.00');
    expect(sent[0]!.url.searchParams.get('refe_id')).toBe(String(refund._id));
    expect(refund).toMatchObject({ status: 'pending', gatewayRef: expect.stringMatching(/^rf/) });

    ctx.services.clock.advance(60 * 60_000);
    await reconcileRefunds(ctx.services.now(), { config: ctx.config, services: ctx.services });
    expect((await Refund.findById(refund._id).setOptions({ crossTenant: true }))!.status).toBe('succeeded');
  });
});
