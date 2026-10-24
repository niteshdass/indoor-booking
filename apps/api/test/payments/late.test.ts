import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { BOOKING_TRANSITIONS, hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { signAccessToken } from '../../src/auth/jwt';
import { seedOwner, bearer } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { connectStripe, piSucceeded, postEvent } from '../helpers/stripe';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Addon } from '../../src/addons/addon.model';
import { AddonAssignment } from '../../src/addons/assignment.model';
import { Booking } from '../../src/bookings/booking.model';
import { SlotLock } from '../../src/bookings/slotLock.model';
import { Payment } from '../../src/bookings/payment.model';
import { PaymentGatewayAccount } from '../../src/payments/gateway.model';
import { WebhookEvent } from '../../src/payments/webhookEvent.model';
import { Refund } from '../../src/payments/refund.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Addon.init(), AddonAssignment.init(), Booking.init(), SlotLock.init(), Payment.init(),
    PaymentGatewayAccount.init(), WebhookEvent.init(), Refund.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const TZ = 'Asia/Dhaka';
// The clock starts 2026-01-01T00:00Z, so this is the next day.
const D = '2026-01-02';
const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '23:00' }]),
);
const at = (hm: string) => localToUtc(D, hmToMin(hm), TZ).toISOString();
const cross = { crossTenant: true };
const LAPSE = 11 * 60_000;

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let slug: string;
let venueId: string;
let turfId: string;
let secret: string;
let accountId: string;

async function newPlayer() {
  const u = await User.create({ name: 'Player', email: `p${Math.random()}@test.local` });
  return { userId: u.id as string, token: await signAccessToken(u.id as string, ctx.config.jwtSecret, ctx.services.now()) };
}

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Addon, AddonAssignment, Booking, SlotLock, Payment, PaymentGatewayAccount, WebhookEvent, Refund].map(
      (m) => (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
  const venue = await seedVenue(owner.ownerId, {
    published: true,
    slug: `arena-${Math.random().toString(36).slice(2, 8)}`,
    timezone: TZ,
    settings: { hours: HOURS, bookingWindowDays: 365, paymentPolicy: { type: 'partial_percent', percent: 20 } },
  });
  const turf = await seedTurf(owner.ownerId, venue.id as string, { pricing: { base: 3000, rules: [] } });
  slug = venue.slug;
  venueId = venue.id as string;
  turfId = turf.id as string;
  ({ webhookSecret: secret, accountId } = await connectStripe(ctx.app, owner));
});

type Player = Awaited<ReturnType<typeof newPlayer>>;

function book(player: Player, startAts: string[], opts: { turf?: string; addons?: object[] } = {}) {
  return request(ctx.app)
    .post(`/api/v1/venues/${slug}/turfs/${opts.turf ?? turfId}/bookings`)
    .set(...bearer(player.token))
    .send({ date: D, startAts, ...(opts.addons ? { addons: opts.addons } : {}) });
}

/** Player 1's 18:00–19:00 booking awaiting payment, with its pending intent payment (3000 total, 600 advance). */
async function paidHold(opts: { addons?: object[] } = {}) {
  const player = await newPlayer();
  const res = await book(player, [at('18:00')], opts);
  expect(res.status).toBe(201);
  const bookingId = res.body.booking.id as string;
  const pay = await request(ctx.app).post(`/api/v1/bookings/${bookingId}/payment`).set(...bearer(player.token)).send({});
  expect(pay.status).toBe(200);
  const payment = (await Payment.findOne({ ownerId: owner.ownerId, _id: pay.body.payment.id }))!;
  return { player, bookingId, payment };
}

/** Lets the hold lapse, then has the player retry payment, which expires the booking and frees its locks. */
async function expireHold(player: Player, bookingId: string) {
  ctx.services.clock.advance(LAPSE);
  const res = await request(ctx.app).post(`/api/v1/bookings/${bookingId}/payment`).set(...bearer(player.token)).send({});
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('hold_expired');
  expect((await bookingOf(bookingId)).status).toBe('expired');
  expect(await locksOf(bookingId)).toBe(0);
}

const bookingOf = async (id: string) => (await Booking.findById(id).setOptions(cross))!;
const paymentOf = async (id: unknown) => (await Payment.findById(id).setOptions(cross))!;
const locksOf = (bookingId: string) => SlotLock.countDocuments({ ownerId: owner.ownerId, bookingId });
const refundCalls = () => ctx.services.stripe.calls.filter((c) => c.method === 'refunds.create');
const refunds = () => Refund.find({ ownerId: owner.ownerId }).lean();
const post = (event: object) => postEvent(ctx.app, owner.ownerId, secret, event);

/** Asserts the payment was refunded once, in full, through the account that took it. */
async function expectRefunded(payment: { _id: unknown; amount: number; gatewayRef?: string | null }, reason: string) {
  const calls = refundCalls();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.params).toEqual({
    payment_intent: payment.gatewayRef, amount: payment.amount, metadata: { refundId: expect.any(String) },
  });
  expect(calls[0]!.idempotencyKey).toBe(`refund_${String(payment._id)}`);
  const intentCall = ctx.services.stripe.calls.find((c) => c.method === 'paymentIntents.create')!;
  expect(calls[0]!.secretKey).toBe(intentCall.secretKey);

  const rows = await refunds();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    amount: payment.amount,
    currency: 'BDT',
    reason,
    gateway: 'stripe',
    gatewayAccountId: accountId,
    status: 'succeeded',
    by: null,
  });
  expect(accountId).toMatch(/^acct_test_/);
  expect(String(rows[0]!.paymentId)).toBe(String(payment._id));
  expect(String(rows[0]!.venueId)).toBe(venueId);
  expect(rows[0]!.gatewayRef).toEqual(expect.any(String));

  expect(await paymentOf(payment._id)).toMatchObject({ status: 'succeeded', refundedAmount: payment.amount });
  const logs = await ActivityLog.find({ ownerId: owner.ownerId, action: 'payment.refund' }).lean();
  expect(logs).toHaveLength(1);
  expect(logs[0]!.actorId).toBeNull();
  expect(String(logs[0]!.entityId)).toBe(String(payment._id));
  expect(logs[0]!.after).toMatchObject({ amount: payment.amount, reason });
  expect(JSON.stringify(logs[0])).not.toMatch(/sk_test|whsec_/);
  expect(JSON.stringify(rows[0])).not.toMatch(/sk_test|whsec_/);
}

describe('late payment for a lapsed hold', () => {
  describe('revive', () => {
    it('revives an expired booking whose slot is still free', async () => {
      const { player, bookingId, payment } = await paidHold();
      await expireHold(player, bookingId);

      const res = await post(piSucceeded(payment));
      expect(res.status).toBe(200);
      const b = await bookingOf(bookingId);
      expect(b).toMatchObject({ status: 'confirmed', amountPaid: 600, paymentStatus: 'partially_paid', holdExpiresAt: null });
      expect(await locksOf(bookingId)).toBe(b.slots.length);
      expect((await paymentOf(payment._id)).status).toBe('succeeded');

      const logs = await ActivityLog.find({ ownerId: owner.ownerId, action: 'booking.revived' }).lean();
      expect(logs).toHaveLength(1);
      expect(logs[0]!.actorId).toBeNull();
      expect(String(logs[0]!.entityId)).toBe(bookingId);
      expect(logs[0]!.before).toMatchObject({ status: 'expired' });
      expect(logs[0]!.after).toMatchObject({ status: 'confirmed', via: 'payment' });
      expect(refundCalls()).toHaveLength(0);
      expect(await refunds()).toHaveLength(0);
      expect((await WebhookEvent.find({}).setOptions(cross).lean())[0]!.outcome).toBe('applied');
    });

    it('keeps expired terminal for staff', async () => {
      expect(BOOKING_TRANSITIONS.expired).toEqual([]);
      const { player, bookingId } = await paidHold();
      await expireHold(player, bookingId);
      const res = await request(ctx.app)
        .post(`/api/v1/owners/${owner.ownerId}/bookings/${bookingId}/confirm`)
        .set(...bearer(owner.token))
        .send({});
      expect(res.status).toBe(409);
      expect((await bookingOf(bookingId)).status).toBe('expired');
    });
  });

  describe('refund', () => {
    it('refunds when another player took the slot, and only once on redelivery', async () => {
      const { bookingId, payment } = await paidHold();
      ctx.services.clock.advance(LAPSE);
      const other = await book(await newPlayer(), [at('18:00')]);
      expect(other.status).toBe(201);
      const otherId = other.body.booking.id as string;
      const before = (await bookingOf(otherId)).toObject();

      const event = piSucceeded(payment);
      expect((await post(event)).status).toBe(200);
      expect(await bookingOf(bookingId)).toMatchObject({ status: 'expired', amountPaid: 0 });
      expect(await locksOf(bookingId)).toBe(0);
      expect(refundCalls()[0]!.params).toEqual({ payment_intent: 'pi_test_1', amount: 600, metadata: { refundId: expect.any(String) } });
      await expectRefunded(payment, 'late_payment');
      expect((await bookingOf(otherId)).toObject()).toEqual(before);
      expect(await locksOf(otherId)).toBe(1);

      const again = await post(event);
      expect(again.status).toBe(200);
      expect(refundCalls()).toHaveLength(1);
      expect(await refunds()).toHaveLength(1);
    });

    it('refunds when an overlapping booking with a different start took the time', async () => {
      const { bookingId, payment } = await paidHold();
      await Turf.updateOne({ ownerId: owner.ownerId, _id: turfId }, { $set: { slotLengthMin: 30 } });
      ctx.services.clock.advance(LAPSE);
      const other = await book(await newPlayer(), [at('18:30'), at('19:00')]);
      expect(other.status).toBe(201);

      expect((await post(piSucceeded(payment))).status).toBe(200);
      expect((await bookingOf(bookingId)).status).toBe('expired');
      expect(await locksOf(bookingId)).toBe(0);
      await expectRefunded(payment, 'late_payment');
    });

    it('refunds once the slot is over, expiring a lapsed hold and freeing its locks', async () => {
      const { bookingId, payment } = await paidHold();
      expect(await locksOf(bookingId)).toBe(1);
      const b = await bookingOf(bookingId);
      ctx.services.clock.advance(b.endAt.getTime() - ctx.services.now().getTime() + 60_000);

      expect((await post(piSucceeded(payment))).status).toBe(200);
      expect(await bookingOf(bookingId)).toMatchObject({ status: 'expired', amountPaid: 0 });
      expect(await locksOf(bookingId)).toBe(0);
      await expectRefunded(payment, 'late_payment');
    });

    describe('stock gone', () => {
      async function withRacket() {
        const racket = await Addon.create({
          ownerId: owner.ownerId, name: 'Racket', pricingType: 'per_unit', price: 100, currency: 'BDT', stock: 1,
        });
        await AddonAssignment.create({ ownerId: owner.ownerId, addonId: racket._id, venueId, turfId: null, enabled: true });
        const turf2 = await seedTurf(owner.ownerId, venueId, { pricing: { base: 3000, rules: [] } });
        const addons = [{ addonId: racket.id as string, quantity: 1 }];
        return { addons, turf2: turf2.id as string };
      }

      it('refunds an expired booking whose stock-limited add-on was taken on another turf', async () => {
        const { addons, turf2 } = await withRacket();
        const { player, bookingId, payment } = await paidHold({ addons });
        await expireHold(player, bookingId);
        expect((await book(await newPlayer(), [at('18:00')], { turf: turf2, addons })).status).toBe(201);

        expect((await post(piSucceeded(payment))).status).toBe(200);
        expect((await bookingOf(bookingId)).status).toBe('expired');
        expect(await locksOf(bookingId)).toBe(0);
        await expectRefunded(payment, 'late_payment');
      });

      it('refunds a lapsed hold whose stock-limited add-on was taken on another turf', async () => {
        const { addons, turf2 } = await withRacket();
        const { bookingId, payment } = await paidHold({ addons });
        ctx.services.clock.advance(LAPSE);
        expect((await book(await newPlayer(), [at('18:00')], { turf: turf2, addons })).status).toBe(201);

        expect((await post(piSucceeded(payment))).status).toBe(200);
        expect((await bookingOf(bookingId)).status).toBe('expired');
        expect(await locksOf(bookingId)).toBe(0);
        await expectRefunded(payment, 'late_payment');
      });

      it('revives when the add-on is still in stock', async () => {
        const { addons } = await withRacket();
        const { player, bookingId, payment } = await paidHold({ addons });
        await expireHold(player, bookingId);

        expect((await post(piSucceeded(payment))).status).toBe(200);
        expect((await bookingOf(bookingId)).status).toBe('confirmed');
        expect(refundCalls()).toHaveLength(0);
      });
    });

    it('refunds a second payment on an already confirmed booking as a duplicate', async () => {
      const { bookingId, payment } = await paidHold();
      expect((await post(piSucceeded(payment))).status).toBe(200);
      expect((await bookingOf(bookingId)).status).toBe('confirmed');

      const second = await Payment.create({
        ownerId: owner.ownerId, venueId, bookingId, method: 'card', kind: 'intent', amount: 600, currency: 'BDT',
        status: 'pending', gateway: 'stripe', gatewayAccountId: accountId, gatewayRef: 'pi_dup_1',
      });
      expect((await post(piSucceeded(second))).status).toBe(200);
      expect(await bookingOf(bookingId)).toMatchObject({ status: 'confirmed', amountPaid: 600 });
      await expectRefunded(second, 'duplicate_payment');
    });

    it('answers 500 on a Stripe refund error and refunds once on redelivery', async () => {
      const { bookingId, payment } = await paidHold();
      ctx.services.clock.advance(LAPSE);
      expect((await book(await newPlayer(), [at('18:00')])).status).toBe(201);

      ctx.services.stripe.fail('refunds.create', 'api');
      const event = piSucceeded(payment);
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await post(event);
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toMatch(/sk_test/);
      } finally {
        logged.mockRestore();
      }
      expect(await WebhookEvent.countDocuments({}).setOptions(cross)).toBe(0);
      expect(await refunds()).toHaveLength(0);
      expect(await paymentOf(payment._id)).toMatchObject({ status: 'pending', refundedAmount: 0 });

      expect((await post(event)).status).toBe(200);
      const calls = refundCalls();
      expect(calls).toHaveLength(2);
      expect(calls.map((c) => c.idempotencyKey)).toEqual([`refund_${String(payment._id)}`, `refund_${String(payment._id)}`]);
      expect(await refunds()).toHaveLength(1);
      expect(await paymentOf(payment._id)).toMatchObject({ status: 'succeeded', refundedAmount: 600 });
      expect((await bookingOf(bookingId)).status).toBe('expired');
    });

    it('calls the gateway only after every database write', async () => {
      // Slot over: the refund path itself expires the hold and frees its locks.
      const { bookingId, payment } = await paidHold();
      const b = await bookingOf(bookingId);
      ctx.services.clock.advance(b.endAt.getTime() - ctx.services.now().getTime() + 60_000);

      // How many refund calls had been made when each write ran: all must be 0 except the result patch.
      const seen: Record<string, number> = {};
      const watch = <T extends object>(model: T, method: keyof T & string, label: string): { mockRestore(): void } => {
        const orig = (model[method] as (...a: unknown[]) => unknown).bind(model);
        const spy = vi.spyOn(model as Record<string, (...a: unknown[]) => unknown>, method);
        return spy.mockImplementation((...args: unknown[]) => {
          seen[label] ??= refundCalls().length;
          return orig(...args);
        });
      };
      const spies = [
        watch(Refund, 'create', 'refund row'),
        watch(ActivityLog, 'create', 'activity'),
        watch(Booking, 'updateOne', 'booking'),
        watch(SlotLock, 'deleteMany', 'locks'),
      ];
      try {
        expect((await post(piSucceeded(payment))).status).toBe(200);
      } finally {
        for (const s of spies) s.mockRestore();
      }
      expect(seen).toEqual({ 'refund row': 0, activity: 0, booking: 0, locks: 0 });
      expect(refundCalls()).toHaveLength(1);
      await expectRefunded(payment, 'late_payment');
    });

    it('records a refund the gateway declines and does not retry it', async () => {
      const { bookingId, payment } = await paidHold();
      ctx.services.clock.advance(LAPSE);
      expect((await book(await newPlayer(), [at('18:00')])).status).toBe(201);

      ctx.services.stripe.refundStatus = 'failed';
      const event = piSucceeded(payment);
      expect((await post(event)).status).toBe(200);
      const rows = await refunds();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'failed', amount: 600, reason: 'late_payment', gatewayAccountId: accountId });
      expect(await paymentOf(payment._id)).toMatchObject({ status: 'succeeded', refundedAmount: 0 });
      expect((await bookingOf(bookingId)).status).toBe('expired');
      expect(await locksOf(bookingId)).toBe(0);
      const logs = await ActivityLog.find({ ownerId: owner.ownerId, action: 'payment.refund' }).lean();
      expect(logs).toHaveLength(1);
      expect(logs[0]!.after).toMatchObject({ status: 'failed' });
      expect((await WebhookEvent.find({}).setOptions(cross).lean())[0]!.outcome).toBe('applied');

      expect((await post(event)).status).toBe(200);
      expect(refundCalls()).toHaveLength(1);
      expect(await refunds()).toHaveLength(1);
    });
  });

  describe('stale holds', () => {
    it("revives over another player's lapsed hold, expiring that hold", async () => {
      const { player, bookingId, payment } = await paidHold();
      await expireHold(player, bookingId);
      const other = await book(await newPlayer(), [at('18:00')]);
      expect(other.status).toBe(201);
      const otherId = other.body.booking.id as string;
      ctx.services.clock.advance(LAPSE);
      expect(await locksOf(otherId)).toBe(1);

      const res = await post(piSucceeded(payment));
      expect(res.status).toBe(200);
      const b = await bookingOf(bookingId);
      expect(b).toMatchObject({ status: 'confirmed', amountPaid: 600 });
      expect(await locksOf(bookingId)).toBe(b.slots.length);
      expect((await bookingOf(otherId)).status).toBe('expired');
      expect(await locksOf(otherId)).toBe(0);
      expect(refundCalls()).toHaveLength(0);
      expect(await refunds()).toHaveLength(0);
    });
  });
});
