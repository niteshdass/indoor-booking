import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { signAccessToken } from '../../src/auth/jwt';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { connectStripe, piSucceeded, postEvent } from '../helpers/stripe';
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
import { PaymentGatewayAccount } from '../../src/payments/gateway.model';
import { WebhookEvent } from '../../src/payments/webhookEvent.model';
import { pendingCardPayment } from '../../src/payments/intent';
import { AppError } from '../../src/errors';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Booking.init(), SlotLock.init(), Payment.init(), PaymentGatewayAccount.init(), WebhookEvent.init(),
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
const cross = { crossTenant: true };
const HOLD_MS = 30 * 60_000;

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let venueId: string;
let turfId: string;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Booking, SlotLock, Payment, PaymentGatewayAccount, WebhookEvent].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
  const venue = await seedVenue(owner.ownerId, {
    published: true,
    timezone: TZ,
    settings: { hours: HOURS, bookingWindowDays: 365 },
  });
  venueId = venue.id as string;
  turfId = (await seedTurf(owner.ownerId, venueId, { pricing: { base: 3000, rules: [] } })).id as string;
});

const ownerUrl = (rest: string, ownerId = owner.ownerId) => `/api/v1/owners/${ownerId}${rest}`;
const walkin = (token: string, payment: object, over: Record<string, unknown> = {}) =>
  request(ctx.app)
    .post(ownerUrl(`/venues/${venueId}/turfs/${turfId}/bookings`))
    .set(...bearer(token))
    .send({ date: D, startAts: [at('18:00')], customer: { name: 'Walk In', phone: '+8801711111111' }, payment, ...over });
const reissue = (token: string, bookingId: string, ownerId = owner.ownerId) =>
  request(ctx.app).post(ownerUrl(`/bookings/${bookingId}/payments/link`, ownerId)).set(...bearer(token)).send({});
const sessionCalls = () => ctx.services.stripe.calls.filter((c) => c.method === 'checkout.sessions.create');

describe('walk-in with a payment link', () => {
  it('holds the booking and returns a Checkout link that expires with the hold', async () => {
    const { accountId } = await connectStripe(ctx.app, owner);
    const res = await walkin(owner.token, { method: 'link' });
    expect(res.status).toBe(201);
    const holdEnd = new Date(ctx.services.now().getTime() + HOLD_MS);
    expect(res.body.booking).toMatchObject({
      status: 'awaiting_payment', total: 3000, amountPaid: 0, paymentStatus: 'unpaid',
      holdExpiresAt: holdEnd.toISOString(),
    });
    const row = (await Payment.findOne({ ownerId: owner.ownerId }))!;
    expect(res.body.payment).toEqual({
      id: String(row._id), amount: 3000, currency: 'BDT', url: 'https://checkout.stripe.test/cs_test_1',
    });
    expect(row).toMatchObject({
      method: 'card', kind: 'link', status: 'pending', amount: 3000, currency: 'BDT',
      gateway: 'stripe', gatewayAccountId: accountId, gatewayRef: null, linkRef: 'cs_test_1',
    });

    const [call] = sessionCalls();
    expect(call!.idempotencyKey).toBe(`link_${row._id}`);
    const metadata = {
      paymentId: String(row._id), bookingId: res.body.booking.id, ownerId: owner.ownerId,
      reference: res.body.booking.reference,
    };
    expect(call!.params).toMatchObject({
      mode: 'payment',
      expires_at: Math.floor(holdEnd.getTime() / 1000),
      success_url: `${ctx.config.appUrl}/payment-complete?reference=${res.body.booking.reference}`,
      line_items: [{ price_data: { currency: 'bdt', unit_amount: 3000 } }],
      metadata,
      payment_intent_data: { metadata },
    });

    const acts = await ActivityLog.find({ ownerId: owner.ownerId, action: /^(booking|payment)\./ }).lean();
    expect(acts.map((r) => r.action)).toEqual(['booking.create']);
    expect(acts[0]!.after).toMatchObject({ status: 'awaiting_payment', total: 3000 });
    expect(JSON.stringify(res.body)).not.toMatch(/sk_test|whsec_/);
  });

  it('takes a partial amount', async () => {
    await connectStripe(ctx.app, owner);
    const res = await walkin(owner.token, { method: 'link', amount: 1000 });
    expect(res.status).toBe(201);
    expect(res.body.payment.amount).toBe(1000);
    expect(sessionCalls()[0]!.params).toMatchObject({ line_items: [{ price_data: { unit_amount: 1000 } }] });
  });

  it('rejects a bad amount or a zero total, creating nothing', async () => {
    await connectStripe(ctx.app, owner);
    for (const amount of [0, 3001]) {
      const res = await walkin(owner.token, { method: 'link', amount });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_amount');
    }
    await Turf.updateOne({ _id: turfId }, { $set: { pricing: { base: 0, rules: [] } } }).setOptions(cross);
    const free = await walkin(owner.token, { method: 'link' });
    expect(free.status).toBe(400);
    expect(free.body.error.code).toBe('nothing_to_pay');
    for (const m of [Booking, SlotLock, Payment]) {
      expect(await (m as typeof Booking).countDocuments({}).setOptions(cross)).toBe(0);
    }
    expect(sessionCalls()).toHaveLength(0);
  });

  it('is unavailable without an enabled gateway, creating nothing', async () => {
    const none = await walkin(owner.token, { method: 'link' });
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe('payments_unavailable');
    await connectStripe(ctx.app, owner, { enabled: false });
    const off = await walkin(owner.token, { method: 'link' });
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('payments_unavailable');
    expect(await Booking.countDocuments({}).setOptions(cross)).toBe(0);
  });

  it('needs booking.create only, not payment.mark_cash', async () => {
    await connectStripe(ctx.app, owner);
    const role = await Role.create({ ownerId: owner.ownerId, name: 'Desk', permissions: ['booking.view', 'booking.create'] });
    const desk = await addMember(ctx.services, owner.ownerId, { roleId: String(role._id) });
    const res = await walkin(desk.token, { method: 'link' });
    expect(res.status).toBe(201);
    expect(res.body.payment.url).toEqual(expect.any(String));
  });

  it('re-issues the same link with one payment row; cash bookings and other owners are refused', async () => {
    await connectStripe(ctx.app, owner);
    const first = await walkin(owner.token, { method: 'link' });
    const again = await reissue(owner.token, first.body.booking.id);
    expect(again.status).toBe(200);
    expect(again.body.payment).toEqual(first.body.payment);
    expect(await Payment.countDocuments({}).setOptions(cross)).toBe(1);
    expect(sessionCalls().map((c) => c.idempotencyKey)).toEqual([
      `link_${first.body.payment.id}`, `link_${first.body.payment.id}`,
    ]);

    const cash = await walkin(owner.token, { method: 'cash' }, { startAts: [at('20:00')] });
    expect(cash.status).toBe(201);
    const refused = await reissue(owner.token, cash.body.booking.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('invalid_transition');

    const other = await seedOwner(ctx.services, { name: 'Other' });
    const foreign = await reissue(other.token, first.body.booking.id, other.ownerId);
    expect(foreign.status).toBe(404);
    const malformed = await reissue(other.token, 'not-an-id', other.ownerId);
    expect(foreign.body).toEqual(malformed.body);
  });

  it('refuses to re-issue a lapsed hold', async () => {
    await connectStripe(ctx.app, owner);
    const first = await walkin(owner.token, { method: 'link' });
    ctx.services.clock.advance(HOLD_MS);
    owner.token = await signAccessToken(owner.userId, ctx.config.jwtSecret, ctx.services.now());
    const res = await reissue(owner.token, first.body.booking.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('hold_expired');
    expect((await Booking.findById(first.body.booking.id).setOptions(cross))!.status).toBe('expired');
  });

  it('keeps the booking when Stripe fails, and the re-issue route recovers the link', async () => {
    await connectStripe(ctx.app, owner);
    ctx.services.stripe.fail('checkout.sessions.create', 'api');
    const res = await walkin(owner.token, { method: 'link' });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('gateway_error');
    expect(JSON.stringify(res.body)).not.toMatch(/sk_test/);
    const booking = (await Booking.findOne({ ownerId: owner.ownerId }))!;
    expect(booking.status).toBe('awaiting_payment');
    const again = await reissue(owner.token, booking.id as string);
    expect(again.status).toBe(200);
    expect(again.body.payment.url).toMatch(/^https:\/\/checkout\.stripe\.test\/cs_test_/);
    expect(await Payment.countDocuments({}).setOptions(cross)).toBe(1);
  });

  it('confirms on the PaymentIntent webhook and records its id', async () => {
    const { webhookSecret } = await connectStripe(ctx.app, owner);
    const res = await walkin(owner.token, { method: 'link' });
    const paymentId = res.body.payment.id as string;
    const event = piSucceeded({ _id: paymentId, amount: 3000, currency: 'BDT', gatewayRef: 'pi_link_1' });
    expect((await postEvent(ctx.app, owner.ownerId, webhookSecret, event)).status).toBe(200);
    const booking = (await Booking.findById(res.body.booking.id).setOptions(cross))!;
    expect(booking).toMatchObject({ status: 'confirmed', amountPaid: 3000, paymentStatus: 'paid', holdExpiresAt: null });
    const payment = (await Payment.findById(paymentId).setOptions(cross))!;
    expect(payment).toMatchObject({ status: 'succeeded', gatewayRef: 'pi_link_1' });
  });

  it('a pending payment of the other kind is a clean 409, not a duplicate-key error', async () => {
    const { accountId } = await connectStripe(ctx.app, owner);
    const res = await walkin(owner.token, { method: 'link' });
    const booking = (await Booking.findById(res.body.booking.id).setOptions(cross))!;
    const fields = { amount: 3000, gateway: 'stripe', gatewayAccountId: accountId };
    const err = await pendingCardPayment(booking, 'intent', fields).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 409, code: 'invalid_transition' });
    expect(String((await pendingCardPayment(booking, 'link', fields))._id)).toBe(res.body.payment.id);
    expect(await Payment.countDocuments({}).setOptions(cross)).toBe(1);
  });
});
