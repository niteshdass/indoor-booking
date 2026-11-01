import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { hmToMin, localToUtc } from '@booking/shared';
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
import { Booking } from '../../src/bookings/booking.model';
import { SlotLock } from '../../src/bookings/slotLock.model';
import { Payment } from '../../src/bookings/payment.model';
import { Refund } from '../../src/payments/refund.model';
import { PaymentGatewayAccount } from '../../src/payments/gateway.model';
import { WebhookEvent } from '../../src/payments/webhookEvent.model';
import { Notification } from '../../src/notifications/notification.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Booking.init(), SlotLock.init(), Payment.init(), Refund.init(), PaymentGatewayAccount.init(), WebhookEvent.init(),
    Notification.init(),
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
    ...[ActivityLog, Venue, Turf, Booking, SlotLock, Payment, Refund, PaymentGatewayAccount, WebhookEvent, Notification].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
  const u = await User.create({ name: 'Player', email: `p${Math.random()}@test.local`, emailVerified: true });
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

/** A 3000 booking confirmed by its 600 card advance. */
async function paidBooking(hm = '18:00') {
  const res = await request(ctx.app)
    .post(`/api/v1/venues/${slug}/turfs/${turfId}/bookings`)
    .set(...bearer(player.token))
    .send({ date: D, startAts: [at(hm)] });
  expect(res.status).toBe(201);
  const bookingId = res.body.booking.id as string;
  const pay = await request(ctx.app).post(`/api/v1/bookings/${bookingId}/payment`).set(...bearer(player.token)).send({});
  expect(pay.status).toBe(200);
  const payment = (await Payment.findOne({ ownerId: owner.ownerId, _id: pay.body.payment.id }))!;
  expect((await post(piSucceeded(payment))).status).toBe(200);
  return { bookingId, payment: (await Payment.findById(payment._id).setOptions(cross))! };
}

let seq = 0;
const stripeEvent = (type: string, object: object, livemode = false) => {
  seq += 1;
  return { id: `evt_dash_${seq}`, object: 'event', type, livemode, data: { object } };
};
const chargeRefunded = (gatewayRef: string, amountRefunded: number, livemode = false) =>
  stripeEvent(
    'charge.refunded',
    { id: `ch_${gatewayRef}`, object: 'charge', payment_intent: gatewayRef, amount: 600, amount_refunded: amountRefunded, currency: 'bdt' },
    livemode,
  );
const dispute = (type: 'created' | 'closed', gatewayRef: string, o: { id?: string; status?: string } = {}) =>
  stripeEvent(`charge.dispute.${type}`, {
    id: o.id ?? 'dp_1',
    object: 'dispute',
    payment_intent: gatewayRef,
    charge: `ch_${gatewayRef}`,
    amount: 600,
    currency: 'bdt',
    reason: 'fraudulent',
    status: o.status ?? (type === 'created' ? 'needs_response' : 'lost'),
  });

const post = (event: object) => postEvent(ctx.app, owner.ownerId, secret, event);
const bookingOf = async (id: string) => (await Booking.findById(id).setOptions(cross))!;
const outcomes = async () => (await WebhookEvent.find({}).setOptions(cross).sort({ _id: 1 }).lean()).map((e) => e.outcome);
const notices = async (event: string) => Notification.find({ event }).setOptions(cross).lean();

describe('charge.refunded', () => {
  it('records a refund made in the Stripe dashboard on the payment and booking, and tells staff', async () => {
    const { bookingId, payment } = await paidBooking();
    expect((await post(chargeRefunded(payment.gatewayRef!, 200))).status).toBe(200);

    const refunds = await Refund.find({ bookingId }).setOptions(cross).lean();
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ reason: 'external', method: 'card', status: 'succeeded', amount: 200, gatewayRef: null });
    expect((await Payment.findById(payment._id).setOptions(cross))!.refundedAmount).toBe(200);
    expect(await bookingOf(bookingId)).toMatchObject({ amountPaid: 600, amountRefunded: 200 });
    expect(await notices('staff_refund_external')).toHaveLength(1);
    expect(await notices('refund_issued')).toHaveLength(1);
    expect((await outcomes()).at(-1)).toBe('applied');
  });

  it('records only the part beyond what the app already refunded, once', async () => {
    const { bookingId, payment } = await paidBooking();
    // The app's own refund, reserved before it reached Stripe.
    await Payment.updateOne({ _id: payment._id }, { $set: { refundedAmount: 100 } }).setOptions(cross);
    await post(chargeRefunded(payment.gatewayRef!, 100));
    expect(await Refund.countDocuments({ bookingId }).setOptions(cross)).toBe(0);

    await post(chargeRefunded(payment.gatewayRef!, 350));
    await post(chargeRefunded(payment.gatewayRef!, 350));
    const refunds = await Refund.find({ bookingId }).setOptions(cross).lean();
    expect(refunds.map((r) => r.amount)).toEqual([250]);
    expect((await Payment.findById(payment._id).setOptions(cross))!.refundedAmount).toBe(350);
    expect((await outcomes()).slice(-3)).toEqual(['ignored', 'applied', 'ignored']);
  });

  it('ignores an intent from the other mode or another owner', async () => {
    const { payment } = await paidBooking();
    await post(chargeRefunded(payment.gatewayRef!, 200, true));
    await post(chargeRefunded('pi_unknown', 200));
    expect(await Refund.countDocuments({}).setOptions(cross)).toBe(0);
    expect((await outcomes()).slice(-2)).toEqual(['unmatched', 'unmatched']);
  });
});

describe('charge.dispute', () => {
  it('flags the booking when a dispute opens and records how it closed', async () => {
    const { bookingId, payment } = await paidBooking();
    await post(dispute('created', payment.gatewayRef!));
    expect((await bookingOf(bookingId)).dispute).toMatchObject({ ref: 'dp_1', status: 'open', amount: 600, reason: 'fraudulent' });
    expect(await notices('staff_dispute_opened')).toHaveLength(1);

    const res = await request(ctx.app).get(`/api/v1/owners/${owner.ownerId}/bookings/${bookingId}`).set(...bearer(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.booking.dispute).toMatchObject({ ref: 'dp_1', status: 'open', closedAt: null });

    await post(dispute('closed', payment.gatewayRef!, { status: 'lost' }));
    const closed = (await bookingOf(bookingId)).dispute!;
    expect(closed).toMatchObject({ status: 'lost' });
    expect(closed.openedAt).not.toBeNull();
    expect(closed.closedAt).not.toBeNull();
    const done = await notices('staff_dispute_closed');
    expect(done).toHaveLength(1);
    expect(done[0]!.data).toMatchObject({ reason: 'lost' });
    expect(await ActivityLog.countDocuments({ ownerId: owner.ownerId, action: /^booking\.dispute_/ })).toBe(2);
  });

  it('applies a repeated opening once and records a close whose opening never came', async () => {
    const { bookingId, payment } = await paidBooking();
    await post(dispute('created', payment.gatewayRef!));
    await post(dispute('created', payment.gatewayRef!));
    expect((await outcomes()).slice(-2)).toEqual(['applied', 'ignored']);

    const other = await paidBooking('20:00');
    await post(dispute('closed', other.payment.gatewayRef!, { id: 'dp_2', status: 'warning_closed' }));
    expect((await bookingOf(other.bookingId)).dispute).toMatchObject({ ref: 'dp_2', status: 'won', openedAt: null });
    expect((await bookingOf(bookingId)).dispute).toMatchObject({ ref: 'dp_1', status: 'open' });
  });
});
