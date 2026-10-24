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
import { PaymentGatewayAccount } from '../../src/payments/gateway.model';
import { WebhookEvent } from '../../src/payments/webhookEvent.model';
import { Refund } from '../../src/payments/refund.model';
import { Notification } from '../../src/notifications/notification.model';
import { deliverNotifications } from '../../src/notifications/outbox';
import { cancelBooking, type Canceller } from '../../src/bookings/cancel';
import type { TenantContext } from '../../src/tenancy/context';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Booking.init(), SlotLock.init(), Payment.init(), PaymentGatewayAccount.init(), WebhookEvent.init(),
    Refund.init(), Notification.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const TZ = 'Asia/Dhaka';
// The clock starts 2026-01-01T00:00Z; 18:00 Dhaka on the 5th is 108 hours later.
const D = '2026-01-05';
const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '23:00' }]),
);
const at = (hm: string) => localToUtc(D, hmToMin(hm), TZ).toISOString();
const cross = { crossTenant: true };
const HOUR = 3_600_000;
const PHONE = '+8801711111111';

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let slug: string;
let turfId: string;
let secret: string;

async function setup(settings: Record<string, unknown>) {
  const venue = await seedVenue(owner.ownerId, {
    published: true,
    slug: `arena-${Math.random().toString(36).slice(2, 8)}`,
    timezone: TZ,
    settings: { hours: HOURS, bookingWindowDays: 365, guestBooking: { allowed: true, requireOtp: false }, ...settings },
  });
  const turf = await seedTurf(owner.ownerId, venue.id as string, { pricing: { base: 5000, rules: [] } });
  slug = venue.slug;
  turfId = turf.id as string;
}

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Booking, SlotLock, Payment, PaymentGatewayAccount, WebhookEvent, Refund, Notification].map(
      (m) => (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
  await setup({
    paymentPolicy: { type: 'partial_percent', percent: 60 },
    refundRules: [{ minHoursBefore: 96, percent: 100 }, { minHoursBefore: 72, percent: 40 }],
  });
  ({ webhookSecret: secret } = await connectStripe(ctx.app, owner));
});

async function newPlayer() {
  const u = await User.create({ name: 'Player', email: `p${Math.random()}@test.local`, emailVerified: true });
  return { userId: u.id as string, token: await signAccessToken(u.id as string, ctx.config.jwtSecret, ctx.services.now()) };
}

const base = () => `/api/v1/venues/${slug}/turfs/${turfId}`;
const bookAs = (token: string | null, hm = '18:00') => {
  const r = request(ctx.app).post(`${base()}/bookings`);
  if (token) r.set(...bearer(token));
  return r.send({ date: D, startAts: [at(hm)], ...(token ? {} : { guest: { name: 'Guest', phone: PHONE } }) });
};
const asOwner = (path: string) => request(ctx.app).post(`/api/v1/owners/${owner.ownerId}${path}`).set(...bearer(owner.token));
const notices = (event?: string) =>
  Notification.find(event ? { event } : {}).setOptions(cross).sort({ _id: 1 }).lean();
const bookingOf = async (id: string) => (await Booking.findById(id).setOptions(cross))!;
const deps = () => ({ config: ctx.config, services: ctx.services });

/** A confirmed booking with its 3000 advance paid by card (webhook). */
async function paid() {
  const player = await newPlayer();
  const res = await bookAs(player.token);
  expect(res.status).toBe(201);
  const bookingId = res.body.booking.id as string;
  const pay = await request(ctx.app).post(`/api/v1/bookings/${bookingId}/payment`).set(...bearer(player.token)).send({});
  expect(pay.status).toBe(200);
  const payment = (await Payment.findById(pay.body.payment.id).setOptions(cross))!;
  expect((await postEvent(ctx.app, owner.ownerId, secret, piSucceeded(payment))).status).toBe(200);
  return { player, bookingId };
}

describe('booking notices', () => {
  it('a guest booking notifies the guest and the venue staff', async () => {
    await setup({});
    const res = await bookAs(null);
    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe('pending');
    const rows = await notices();
    expect(rows.map((r) => [r.event, r.channel, r.to])).toEqual(
      expect.arrayContaining([
        ['booking_pending', 'sms', PHONE],
        ['staff_new_pending', 'email', expect.stringContaining('@test.local')],
      ]),
    );
    expect(rows.every((r) => String(r.bookingId) === res.body.booking.id)).toBe(true);
  });

  it('a registered no-advance booking sends a confirmation', async () => {
    await setup({});
    const player = await newPlayer();
    const res = await bookAs(player.token);
    expect(res.body.booking.status).toBe('confirmed');
    expect((await notices()).map((r) => [r.event, r.channel])).toEqual([['booking_confirmed', 'email']]);
  });

  it('a hold sends nothing until the payment confirms it', async () => {
    const player = await newPlayer();
    const res = await bookAs(player.token);
    expect(res.body.booking.status).toBe('awaiting_payment');
    expect(await notices()).toHaveLength(0);
    const pay = await request(ctx.app).post(`/api/v1/bookings/${res.body.booking.id}/payment`).set(...bearer(player.token)).send({});
    const payment = (await Payment.findById(pay.body.payment.id).setOptions(cross))!;
    expect((await postEvent(ctx.app, owner.ownerId, secret, piSucceeded(payment))).status).toBe(200);
    expect((await notices()).map((r) => r.event)).toEqual(['booking_confirmed']);
  });

  it('staff confirm and reject notify the customer', async () => {
    await setup({});
    const a = await bookAs(null, '18:00');
    const b = await bookAs(null, '19:00');
    expect((await notices()).filter((r) => r.event === 'booking_pending')).toHaveLength(2);
    expect((await asOwner(`/bookings/${a.body.booking.id}/confirm`).send({})).status).toBe(200);
    expect((await notices('booking_confirmed')).map((r) => String(r.bookingId))).toEqual([a.body.booking.id]);
    expect((await asOwner(`/bookings/${b.body.booking.id}/reject`).send({ reason: 'Pitch flooded' })).status).toBe(200);
    const rejected = await notices('booking_rejected');
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]!.bookingId)).toBe(b.body.booking.id);
    expect(rejected[0]!.data).toMatchObject({ reason: 'Pitch flooded' });
  });

  it('a cancel with a refund notifies cancellation and, once settled, the refund', async () => {
    const { player, bookingId } = await paid();
    ctx.services.clock.advance(28 * HOUR);
    const canceller: Canceller = { kind: 'player', ownerId: owner.ownerId, userId: player.userId };
    await cancelBooking(await bookingOf(bookingId), canceller, {}, deps());
    const cancelled = await notices('booking_cancelled');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!.data).toMatchObject({ amount: 1200 });
    const issued = await notices('refund_issued');
    expect(issued).toHaveLength(1);
    expect(issued[0]!.data).toMatchObject({ amount: 1200 });
  });

  it('a cash refund notifies when staff record it', async () => {
    await setup({});
    const player = await newPlayer();
    const res = await bookAs(player.token);
    const bookingId = res.body.booking.id as string;
    const cash = await asOwner(`/bookings/${bookingId}/payments/cash`).send({ amount: 3000 });
    expect(cash.status).toBe(201);
    const staff: Canceller = {
      kind: 'staff',
      t: { ownerId: owner.ownerId, userId: owner.userId } as unknown as TenantContext,
    };
    await cancelBooking(await bookingOf(bookingId), staff, {}, deps());
    const row = (await Refund.findOne({ ownerId: owner.ownerId }).lean())!;
    expect(row).toMatchObject({ method: 'cash', status: 'pending' });
    expect(await notices('booking_cancelled')).toHaveLength(1);
    expect(await notices('refund_issued')).toHaveLength(0);
    expect((await asOwner(`/refunds/${String(row._id)}/record-cash`).send({})).status).toBe(200);
    expect(await notices('refund_issued')).toHaveLength(1);
  });

  it('a failed refund sends no refund notice', async () => {
    const { player, bookingId } = await paid();
    ctx.services.clock.advance(28 * HOUR);
    ctx.services.stripe.refundStatus = 'failed';
    await cancelBooking(await bookingOf(bookingId), { kind: 'player', ownerId: owner.ownerId, userId: player.userId }, {}, deps());
    expect((await Refund.findOne({ ownerId: owner.ownerId }).lean())!.status).toBe('failed');
    expect(await notices('booking_cancelled')).toHaveLength(1);
    expect(await notices('refund_issued')).toHaveLength(0);
  });

  it('a provider outage never fails a booking', async () => {
    await setup({});
    ctx.services.sms.send = async () => {
      throw new Error('sms provider down');
    };
    const res = await bookAs(null);
    expect(res.status).toBe(201);
    const [row] = await notices('booking_pending');
    expect(row).toMatchObject({ status: 'pending', channel: 'sms', attempts: 0 });
    await expect(deliverNotifications(ctx.services.now(), { config: ctx.config, services: ctx.services })).resolves.not.toThrow();
    const after = (await Notification.findById(row!._id).setOptions(cross).lean())!;
    expect(after).toMatchObject({ attempts: 1 });
    expect(after.lastError).toContain('sms provider down');
  });
});
