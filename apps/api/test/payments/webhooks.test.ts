import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { signAccessToken } from '../../src/auth/jwt';
import { seedOwner, bearer } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { connectStripe, piCanceled, piFailed, piSucceeded, postEvent, sessionExpired, signedEvent } from '../helpers/stripe';
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

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let player: { userId: string; token: string };
let slug: string;
let turfId: string;
let secret: string;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Booking, SlotLock, Payment, PaymentGatewayAccount, WebhookEvent].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
  const u = await User.create({ name: 'Player', email: `p${Math.random()}@test.local` });
  player = { userId: u.id as string, token: await signAccessToken(u.id as string, ctx.config.jwtSecret, ctx.services.now()) };
  const venue = await seedVenue(owner.ownerId, {
    published: true,
    slug: `arena-${Math.random().toString(36).slice(2, 8)}`,
    timezone: TZ,
    settings: { hours: HOURS, bookingWindowDays: 365, paymentPolicy: { type: 'partial_percent', percent: 20 } },
  });
  const turf = await seedTurf(owner.ownerId, venue.id as string, { pricing: { base: 3000, rules: [] } });
  slug = venue.slug;
  turfId = turf.id as string;
  ({ webhookSecret: secret } = await connectStripe(ctx.app, owner));
});

/** A 3000 booking with a 600 advance, awaiting payment, with its pending intent payment. */
async function paidHold(hm = '18:00') {
  const res = await request(ctx.app)
    .post(`/api/v1/venues/${slug}/turfs/${turfId}/bookings`)
    .set(...bearer(player.token))
    .send({ date: D, startAts: [at(hm)] });
  expect(res.status).toBe(201);
  const bookingId = res.body.booking.id as string;
  const pay = await request(ctx.app).post(`/api/v1/bookings/${bookingId}/payment`).set(...bearer(player.token)).send({});
  expect(pay.status).toBe(200);
  const payment = (await Payment.findOne({ ownerId: owner.ownerId, _id: pay.body.payment.id }))!;
  return { bookingId, payment };
}

const bookingOf = async (id: string) => (await Booking.findById(id).setOptions(cross))!;
const paymentOf = async (id: unknown) => (await Payment.findById(id).setOptions(cross))!;
const events = () => WebhookEvent.find({}).setOptions(cross).lean();
const post = (event: object, ownerId = owner.ownerId, whsec = secret) => postEvent(ctx.app, ownerId, whsec, event);

describe('POST /webhooks/stripe/:ownerId', () => {
  describe('confirm', () => {
    it('confirms the hold on payment_intent.succeeded', async () => {
      const { bookingId, payment } = await paidHold();
      const event = piSucceeded(payment);
      const res = await post(event);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });

      const b = await bookingOf(bookingId);
      expect(b).toMatchObject({ status: 'confirmed', amountPaid: 600, paymentStatus: 'partially_paid', holdExpiresAt: null });
      const p = await paymentOf(payment._id);
      expect(p.status).toBe('succeeded');
      expect(p.gatewayRef).toBe(payment.gatewayRef);

      const logs = await ActivityLog.find({ ownerId: owner.ownerId, action: 'booking.confirmed' }).lean();
      expect(logs).toHaveLength(1);
      expect(logs[0]!.actorId).toBeNull();
      expect(logs[0]!.after).toMatchObject({ status: 'confirmed', via: 'payment' });

      const list = await request(ctx.app).get(`/api/v1/owners/${owner.ownerId}/activity`).set(...bearer(owner.token));
      expect(list.body.items.find((i: { action: string }) => i.action === 'booking.confirmed').actor).toBeNull();

      const rows = await events();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        ownerId: expect.anything(),
        gateway: 'stripe',
        eventId: event.id,
        type: 'payment_intent.succeeded',
        outcome: 'applied',
      });
      expect(String(rows[0]!.ownerId)).toBe(owner.ownerId);
    });

    it('confirms a lapsed hold whose slot nobody took', async () => {
      const { bookingId, payment } = await paidHold();
      ctx.services.clock.advance(11 * 60_000);
      expect((await post(piSucceeded(payment))).status).toBe(200);
      expect((await bookingOf(bookingId)).status).toBe('confirmed');
      expect((await events())[0]!.outcome).toBe('applied');
    });

    it('still applies events after the gateway is disabled', async () => {
      const { bookingId, payment } = await paidHold();
      const off = await request(ctx.app)
        .patch(`/api/v1/owners/${owner.ownerId}/payment-gateways/stripe`)
        .set(...bearer(owner.token))
        .send({ enabled: false });
      // A JSON route after the webhook mount still parses its body.
      expect(off.status).toBe(200);
      expect(off.body.gateway.enabled).toBe(false);
      expect((await post(piSucceeded(payment))).status).toBe(200);
      expect((await bookingOf(bookingId)).status).toBe('confirmed');
    });
  });

  describe('duplicates', () => {
    it('applies a redelivered event once', async () => {
      const { bookingId, payment } = await paidHold();
      const event = piSucceeded(payment);
      expect((await post(event)).status).toBe(200);
      const again = await post(event);
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ received: true });
      expect((await bookingOf(bookingId)).amountPaid).toBe(600);
      expect(await events()).toHaveLength(1);
      expect(await ActivityLog.countDocuments({ ownerId: owner.ownerId, action: 'booking.confirmed' })).toBe(1);
    });

    it('applies a concurrently delivered event once', async () => {
      const { bookingId, payment } = await paidHold();
      const event = piSucceeded(payment);
      const [a, b] = await Promise.all([post(event), post(event)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect((await bookingOf(bookingId)).amountPaid).toBe(600);
      expect(await events()).toHaveLength(1);
      expect(await ActivityLog.countDocuments({ ownerId: owner.ownerId, action: 'booking.confirmed' })).toBe(1);
    });
  });

  describe('out of order', () => {
    it('ignores a cancel that arrives after the success', async () => {
      const { bookingId, payment } = await paidHold();
      await post(piSucceeded(payment));
      expect((await post(piCanceled(payment))).status).toBe(200);
      expect((await paymentOf(payment._id)).status).toBe('succeeded');
      expect((await bookingOf(bookingId)).status).toBe('confirmed');
      expect((await events()).map((e) => e.outcome)).toEqual(['applied', 'ignored']);
    });

    it('records a failed attempt and still confirms on a later success', async () => {
      const { bookingId, payment } = await paidHold();
      expect((await post(piFailed(payment))).status).toBe(200);
      const p = await paymentOf(payment._id);
      expect(p).toMatchObject({ status: 'pending', failureCode: 'card_declined' });
      expect((await bookingOf(bookingId)).status).toBe('awaiting_payment');

      await post(piSucceeded(payment));
      expect((await bookingOf(bookingId)).status).toBe('confirmed');
      expect((await paymentOf(payment._id)).status).toBe('succeeded');
    });
  });

  describe('closed payments', () => {
    for (const [name, build] of [['checkout.session.expired', sessionExpired], ['payment_intent.canceled', piCanceled]] as const) {
      it(`fails a pending payment on ${name} and leaves the booking alone`, async () => {
        const { bookingId, payment } = await paidHold();
        const before = await bookingOf(bookingId);
        expect((await post(build(payment))).status).toBe(200);
        expect((await paymentOf(payment._id)).status).toBe('failed');
        const after = await bookingOf(bookingId);
        expect(after.status).toBe('awaiting_payment');
        expect(after.amountPaid).toBe(0);
        expect(after.holdExpiresAt).toEqual(before.holdExpiresAt);
        expect((await events())[0]!.outcome).toBe('applied');
      });
    }
  });

  describe('bad input', () => {
    it('changes nothing when the amount or currency differ', async () => {
      const { bookingId, payment } = await paidHold();
      expect((await post(piSucceeded(payment, { amount: 599 }))).status).toBe(200);
      expect((await post(piSucceeded(payment, { currency: 'usd' }))).status).toBe(200);
      expect((await events()).map((e) => e.outcome)).toEqual(['mismatch', 'mismatch']);
      expect((await paymentOf(payment._id)).status).toBe('pending');
      expect(await bookingOf(bookingId)).toMatchObject({ status: 'awaiting_payment', amountPaid: 0 });
    });

    it('answers 200 unmatched for an unknown or malformed payment id', async () => {
      const { payment } = await paidHold();
      expect((await post(piSucceeded(payment, { paymentId: '64b000000000000000000000' }))).status).toBe(200);
      expect((await post(piSucceeded(payment, { paymentId: 'nope' }))).status).toBe(200);
      expect((await events()).map((e) => e.outcome)).toEqual(['unmatched', 'unmatched']);
    });

    it("does not let another owner's endpoint touch this owner's payment", async () => {
      const { bookingId, payment } = await paidHold();
      const other = await seedOwner(ctx.services, { name: 'Other' });
      const { webhookSecret: otherSecret } = await connectStripe(ctx.app, other);

      const res = await post(piSucceeded(payment), other.ownerId, otherSecret);
      expect(res.status).toBe(200);
      const rows = await events();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ outcome: 'unmatched' });
      expect(String(rows[0]!.ownerId)).toBe(other.ownerId);
      expect((await bookingOf(bookingId)).status).toBe('awaiting_payment');
      expect((await paymentOf(payment._id)).status).toBe('pending');

      const crossSigned = await post(piSucceeded(payment), other.ownerId, secret);
      expect(crossSigned.status).toBe(400);
      expect(crossSigned.body.error.code).toBe('invalid_signature');
    });

    it('rejects a bad or missing signature without recording the event', async () => {
      const { bookingId, payment } = await paidHold();
      const bad = await post(piSucceeded(payment), owner.ownerId, 'whsec_wrong');
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('invalid_signature');
      const { body } = signedEvent(secret, piSucceeded(payment));
      const missing = await request(ctx.app)
        .post(`/api/v1/webhooks/stripe/${owner.ownerId}`)
        .set('Content-Type', 'application/json')
        .send(body);
      expect(missing.status).toBe(400);
      expect(missing.body.error.code).toBe('invalid_signature');
      expect(await events()).toHaveLength(0);
      expect((await bookingOf(bookingId)).status).toBe('awaiting_payment');
    });

    it('404s an unknown gateway, a malformed owner id and an owner without a gateway, alike', async () => {
      const { payment } = await paidHold();
      const { body, signature } = signedEvent(secret, piSucceeded(payment));
      const send = (path: string) =>
        request(ctx.app).post(path).set('stripe-signature', signature).set('Content-Type', 'application/json').send(body);
      const bare = await seedOwner(ctx.services, { name: 'Bare' });

      const responses = await Promise.all([
        send(`/api/v1/webhooks/paypal/${owner.ownerId}`),
        send('/api/v1/webhooks/stripe/not-an-id'),
        send(`/api/v1/webhooks/stripe/${bare.ownerId}`),
      ]);
      for (const r of responses) {
        expect(r.status).toBe(404);
        expect(r.body).toEqual(responses[1]!.body);
      }
      expect(responses[1]!.body.error.code).toBe('not_found');
      expect(await events()).toHaveLength(0);
    });
  });

  describe('raw body', () => {
    it('verifies the raw bytes and records an unrelated event as ignored', async () => {
      const event = { id: 'evt_customer', object: 'event', type: 'customer.created', data: { object: { id: 'cus_1', object: 'customer' } } };
      const res = await post(event);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
      const rows = await events();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ eventId: 'evt_customer', type: 'customer.created', outcome: 'ignored' });
    });
  });
});
