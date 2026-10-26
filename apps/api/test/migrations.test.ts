import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from './helpers/testDb';
import { buildTestApp } from './helpers/testApp';
import { seedOwner } from './helpers/tenancy';
import { seedTurf, seedVenue } from './helpers/venues';
import { connectStripe, piSucceeded, postEvent } from './helpers/stripe';
import { signAccessToken } from '../src/auth/jwt';
import { User } from '../src/auth/user.model';
import { Owner } from '../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../src/tenancy/role.model';
import { Membership } from '../src/tenancy/membership.model';
import { ActivityLog } from '../src/tenancy/activityLog.model';
import type { TenantContext } from '../src/tenancy/context';
import { Venue } from '../src/venues/venue.model';
import { Turf } from '../src/venues/turf.model';
import { Booking } from '../src/bookings/booking.model';
import { SlotLock } from '../src/bookings/slotLock.model';
import { Payment } from '../src/bookings/payment.model';
import { PaymentGatewayAccount } from '../src/payments/gateway.model';
import { WebhookEvent } from '../src/payments/webhookEvent.model';
import { Refund } from '../src/payments/refund.model';
import { cancelBooking, type Canceller } from '../src/bookings/cancel';
import { reconcileRefunds } from '../src/payments/refunds';
import { Migration } from '../src/migrations/model';
import { MIGRATIONS, runMigrations } from '../src/migrations';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Booking.init(), SlotLock.init(), Payment.init(), PaymentGatewayAccount.init(), WebhookEvent.init(), Refund.init(),
    Migration.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const TZ = 'Asia/Dhaka';
const D = '2026-01-05';
const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '23:00' }]),
);
const at = (hm: string) => localToUtc(D, hmToMin(hm), TZ).toISOString();
const cross = { crossTenant: true };
const MIN = 60_000;

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let slug: string;
let turfId: string;
let secret: string;

beforeEach(async () => {
  await Migration.deleteMany({});
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Booking, SlotLock, Payment, PaymentGatewayAccount, WebhookEvent, Refund].map(
      (m) => (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
  const venue = await seedVenue(owner.ownerId, {
    published: true,
    slug: `arena-${Math.random().toString(36).slice(2, 8)}`,
    timezone: TZ,
    settings: { hours: HOURS, bookingWindowDays: 365, paymentPolicy: { type: 'partial_percent', percent: 60 }, refundRules: [] },
  });
  const turf = await seedTurf(owner.ownerId, venue.id as string, { pricing: { base: 5000, rules: [] } });
  slug = venue.slug;
  turfId = turf.id as string;
  ({ webhookSecret: secret } = await connectStripe(ctx.app, owner));
});

/** A confirmed 5000 booking with 3000 paid by card (webhook). */
async function paid() {
  const u = await User.create({ name: 'Player', email: `p${Math.random()}@test.local` });
  const token = await signAccessToken(u.id as string, ctx.config.jwtSecret, ctx.services.now());
  const res = await request(ctx.app)
    .post(`/api/v1/venues/${slug}/turfs/${turfId}/bookings`)
    .set('Authorization', `Bearer ${token}`)
    .send({ date: D, startAts: [at('18:00')] });
  expect(res.status).toBe(201);
  const bookingId = res.body.booking.id as string;
  const pay = await request(ctx.app).post(`/api/v1/bookings/${bookingId}/payment`).set('Authorization', `Bearer ${token}`).send({});
  const payment = (await Payment.findById(pay.body.payment.id).setOptions(cross))!;
  expect((await postEvent(ctx.app, owner.ownerId, secret, piSucceeded(payment))).status).toBe(200);
  return { bookingId, payment };
}

/** A Plan 08 refund row: no method, attempts or ruleApplied. */
async function legacyRefund(
  p: { _id: unknown; venueId: unknown; bookingId: unknown; gatewayAccountId?: unknown },
  over: Record<string, unknown> = {},
) {
  const _id = new mongoose.Types.ObjectId();
  const old = new Date(ctx.services.now().getTime() - 60 * MIN);
  await Refund.collection.insertOne({
    _id, ownerId: new mongoose.Types.ObjectId(owner.ownerId), venueId: p.venueId, bookingId: p.bookingId, paymentId: p._id,
    amount: 3000, currency: 'BDT', reason: 'cancellation', gateway: 'stripe', gatewayAccountId: p.gatewayAccountId ?? null,
    gatewayRef: null, status: 'pending', failureCode: null, dispatchedAt: null, retryOf: null, settledAt: null, by: null,
    createdAt: old, updatedAt: old, __v: 0, ...over,
  });
  return _id;
}
const rawRefund = (id: unknown) => Refund.collection.findOne({ _id: id as mongoose.Types.ObjectId });
const rawPayment = (id: unknown) => Payment.collection.findOne({ _id: id as mongoose.Types.ObjectId });

describe('runMigrations', () => {
  it('plan 08 refunds get method card', async () => {
    const { payment } = await paid();
    const id = await legacyRefund(payment, { status: 'succeeded' });
    const before = await rawRefund(id);
    expect(before).not.toHaveProperty('method');
    expect(await runMigrations(ctx.services.now())).toContain('2026-10-24-refund-method');
    const after = await rawRefund(id);
    expect(after).toMatchObject({ method: 'card', attempts: 0 });
    expect(after!.updatedAt).toEqual(before!.updatedAt);
  });

  it('payments refunded as late or duplicate are marked excess; others are not', async () => {
    const { payment: a } = await paid();
    const mk = (ref: string) =>
      Payment.create({
        ownerId: owner.ownerId, venueId: a.venueId, bookingId: a.bookingId, method: 'card', kind: 'intent', amount: 3000, currency: 'BDT',
        status: 'succeeded', gateway: 'stripe', gatewayAccountId: a.gatewayAccountId, gatewayRef: ref,
      });
    const [late, dup, plain] = await Promise.all([mk('pi_late'), mk('pi_dup'), mk('pi_plain')]);
    await legacyRefund(late, { reason: 'late_payment' });
    await legacyRefund(dup, { reason: 'duplicate_payment' });
    await legacyRefund(plain, { reason: 'cancellation' });
    await Payment.collection.updateMany({}, { $unset: { excess: '' } });
    await runMigrations(ctx.services.now());
    expect((await rawPayment(late._id))!.excess).toBe(true);
    expect((await rawPayment(dup._id))!.excess).toBe(true);
    expect((await rawPayment(plain._id))!.excess).toBeUndefined();
    expect((await rawPayment(a._id))!.excess).toBeUndefined();
  });

  it('backfills completedAt from endAt and marks the prompt as handled', async () => {
    const { bookingId } = await paid();
    await Booking.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(bookingId) },
      { $set: { status: 'completed' }, $unset: { completedAt: '', reviewRequestedAt: '', reviewedAt: '' } },
    );
    const now = ctx.services.now();
    await runMigrations(now);
    const raw = await Booking.collection.findOne({ _id: new mongoose.Types.ObjectId(bookingId) });
    expect(raw!.completedAt).toEqual(raw!.endAt);
    expect(raw!.reviewRequestedAt).toEqual(now);
    const step = MIGRATIONS.find((m) => m.id === '2026-10-25-booking-completed-at')!;
    expect(await step.run(now)).toBe(0);
  });

  it('a second run applies nothing', async () => {
    expect(await runMigrations(ctx.services.now())).toEqual(MIGRATIONS.map((m) => m.id));
    expect(await runMigrations(ctx.services.now())).toEqual([]);
    expect(await Migration.countDocuments({})).toBe(MIGRATIONS.length);
  });

  it('a cancel after migration no longer draws from the old duplicate payment', async () => {
    const { payment: a, bookingId } = await paid();
    const b = await Payment.create({
      ownerId: owner.ownerId, venueId: a.venueId, bookingId, method: 'card', kind: 'intent', amount: 3000, currency: 'BDT',
      status: 'pending', gateway: 'stripe', gatewayAccountId: a.gatewayAccountId, gatewayRef: 'pi_dup_1',
    });
    ctx.services.stripe.refundStatus = 'failed';
    expect((await postEvent(ctx.app, owner.ownerId, secret, piSucceeded(b))).status).toBe(200);
    ctx.services.stripe.refundStatus = 'succeeded';
    // Back to the Plan 08 shape: B has no excess flag and its failed refund no method.
    await Payment.collection.updateOne({ _id: b._id }, { $unset: { excess: '' } });
    await Refund.collection.updateMany({ paymentId: b._id }, { $unset: { method: '', attempts: '', ruleApplied: '' } });

    await runMigrations(ctx.services.now());
    const booking = (await Booking.findById(bookingId).setOptions(cross))!;
    const staff: Canceller = { kind: 'staff', t: { ownerId: owner.ownerId, userId: owner.userId } as unknown as TenantContext };
    const out = await cancelBooking(booking, staff, {}, { config: ctx.config, services: ctx.services });
    expect(out.refunds.map((r) => [String(r.paymentId), r.amount, r.status])).toEqual([[String(a._id), 3000, 'succeeded']]);
  });

  it('a migrated legacy pending refund is dispatched by reconcileRefunds', async () => {
    const { payment } = await paid();
    const id = await legacyRefund(payment);
    await runMigrations(ctx.services.now());
    expect(await reconcileRefunds(ctx.services.now(), { config: ctx.config, services: ctx.services })).toEqual({ dispatched: 1 });
    expect(ctx.services.stripe.calls.filter((c) => c.method === 'refunds.create')).toHaveLength(1);
    expect(await rawRefund(id)).toMatchObject({ status: 'succeeded', attempts: 1 });
  });
});

describe('gateway modes', () => {
  it('moves legacy keys under their mode and stamps the payments and refunds taken with them', async () => {
    const { payment } = await paid();
    const refundId = await legacyRefund(payment);
    // Back to the single-key shape.
    const gw = (await PaymentGatewayAccount.collection.findOne({ ownerId: new mongoose.Types.ObjectId(owner.ownerId) }))!;
    await PaymentGatewayAccount.collection.updateOne(
      { _id: gw._id },
      { $set: { ...gw.keys.test }, $unset: { keys: '' } },
    );
    await Payment.collection.updateOne({ _id: payment._id }, { $unset: { gatewayMode: '' } });

    expect(await runMigrations(ctx.services.now())).toContain('2026-10-26-gateway-modes');
    const after = (await PaymentGatewayAccount.collection.findOne({ _id: gw._id }))!;
    expect(after).not.toHaveProperty('credentialsEncrypted');
    expect(after.keys.test).toEqual(gw.keys.test);
    expect((await rawPayment(payment._id))!.gatewayMode).toBe('test');
    expect((await rawRefund(refundId))!.gatewayMode).toBe('test');
    expect(await MIGRATIONS.find((m) => m.id === '2026-10-26-gateway-modes')!.run(ctx.services.now())).toBe(0);
  });

  it('refunds a test payment with the test keys after switching to live', async () => {
    const { bookingId } = await paid();
    await connectStripe(ctx.app, owner, { secretKey: 'sk_live_after1' });
    const sw = await request(ctx.app)
      .patch(`/api/v1/owners/${owner.ownerId}/payment-gateways/stripe`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ mode: 'live' });
    expect(sw.status).toBe(200);
    const booking = (await Booking.findById(bookingId).setOptions(cross))!;
    const staff: Canceller = { kind: 'staff', t: { ownerId: owner.ownerId, userId: owner.userId } as unknown as TenantContext };
    const out = await cancelBooking(booking, staff, {}, { config: ctx.config, services: ctx.services });
    expect(out.refunds.map((r) => r.status)).toEqual(['succeeded']);
    const calls = ctx.services.stripe.calls.filter((c) => c.method === 'refunds.create');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.secretKey).toMatch(/^sk_test_/);
  });
});
