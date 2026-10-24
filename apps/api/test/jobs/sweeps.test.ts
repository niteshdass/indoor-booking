import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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
import {
  autoCompleteBookings,
  autoRejectPending,
  expireHolds,
  sendReminders,
  warnExpiringHolds,
} from '../../src/jobs/sweeps';

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
const MIN = 60_000;
const HOUR = 60 * MIN;
const PHONE = '+8801711111111';

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let slug: string;
let venueId: string;
let turfId: string;
let secret: string;

/** A fresh venue and turf that later bookings go to; with no payment policy, guests are pending and players confirmed. */
async function setup(settings: Record<string, unknown>) {
  const venue = await seedVenue(owner.ownerId, {
    published: true,
    slug: `arena-${Math.random().toString(36).slice(2, 8)}`,
    timezone: TZ,
    settings: { hours: HOURS, bookingWindowDays: 365, guestBooking: { allowed: true, requireOtp: false }, ...settings },
  });
  const turf = await seedTurf(owner.ownerId, venue.id as string, { pricing: { base: 5000, rules: [] } });
  slug = venue.slug;
  venueId = venue.id as string;
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
  // Players' bookings here are held awaiting a 60% advance.
  await setup({ paymentPolicy: { type: 'partial_percent', percent: 60 } });
  ({ webhookSecret: secret } = await connectStripe(ctx.app, owner));
});

async function newPlayer(opts: { phone?: string } = {}) {
  const u = await User.create({
    name: 'Player',
    email: `p${Math.random()}@test.local`,
    emailVerified: true,
    ...(opts.phone ? { phone: opts.phone, phoneVerified: true } : {}),
  });
  return { userId: u.id as string, token: await signAccessToken(u.id as string, ctx.config.jwtSecret, ctx.services.now()) };
}

const now = () => ctx.services.now();
/** Moves the clock to `t`, which must not be in the past. */
const advanceTo = (t: Date | string) => ctx.services.clock.advance(new Date(t).getTime() - now().getTime());

const bookAs = async (token: string | null, hm = '18:00') => {
  const r = request(ctx.app).post(`/api/v1/venues/${slug}/turfs/${turfId}/bookings`);
  if (token) r.set(...bearer(token));
  const res = await r.send({ date: D, startAts: [at(hm)], ...(token ? {} : { guest: { name: 'Guest', phone: PHONE } }) });
  expect(res.status).toBe(201);
  return res.body.booking as { id: string; status: string; startAt: string; endAt: string };
};
/** A player's hold with a pending in-app (intent) card payment. */
async function intentHold(hm = '18:00') {
  const player = await newPlayer();
  const booking = await bookAs(player.token, hm);
  expect(booking.status).toBe('awaiting_payment');
  const pay = await request(ctx.app).post(`/api/v1/bookings/${booking.id}/payment`).set(...bearer(player.token)).send({});
  expect(pay.status).toBe(200);
  const payment = (await Payment.findById(pay.body.payment.id).setOptions(cross))!;
  return { player, bookingId: booking.id, payment };
}
/** The owner's token signed now, since tests move the clock days past the seeded one. */
const ownerToken = () => signAccessToken(owner.userId, ctx.config.jwtSecret, now());
const asOwner = (token: string, path: string) =>
  request(ctx.app).post(`/api/v1/owners/${owner.ownerId}${path}`).set(...bearer(token));
const notices = (event: string) => Notification.find({ event }).setOptions(cross).sort({ _id: 1 }).lean();
const bookingOf = async (id: string) => (await Booking.findById(id).setOptions(cross))!;
const locksOf = (bookingId: string) => SlotLock.countDocuments({ ownerId: owner.ownerId, bookingId });
const startOf = async (id: string) => (await bookingOf(id)).startAt;

describe('expireHolds', () => {
  it('a lapsed hold expires and frees its slot', async () => {
    const { bookingId } = await intentHold();
    expect(await locksOf(bookingId)).toBe(1);
    ctx.services.clock.advance(11 * MIN);

    expect(await expireHolds(now())).toBe(1);
    expect((await bookingOf(bookingId)).status).toBe('expired');
    expect(await locksOf(bookingId)).toBe(0);
    const logs = await ActivityLog.find({ ownerId: owner.ownerId, action: 'booking.expired' }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorId).toBeNull();
    expect(String(logs[0]!.entityId)).toBe(bookingId);
    expect(logs[0]!.before).toMatchObject({ status: 'awaiting_payment' });

    const other = await bookAs((await newPlayer()).token);
    expect(other.status).toBe('awaiting_payment');
    expect(await expireHolds(now())).toBe(0);
  });

  it('a live hold is left alone', async () => {
    const { bookingId, payment } = await intentHold();
    ctx.services.clock.advance(9 * MIN);
    expect(await expireHolds(now())).toBe(0);
    expect((await bookingOf(bookingId)).status).toBe('awaiting_payment');
    expect(await locksOf(bookingId)).toBe(1);
    expect((await Payment.findById(payment._id).setOptions(cross))!.status).toBe('pending');
  });

  describe('a payment that lands after the job expired the hold still revives the booking', () => {
    it('revives it while the slot is free', async () => {
      const { bookingId, payment } = await intentHold();
      ctx.services.clock.advance(11 * MIN);
      const callsBefore = ctx.services.stripe.calls.length;
      expect(await expireHolds(now())).toBe(1);
      // The job leaves the payment and the Stripe intent to the late-payment path.
      expect((await Payment.findById(payment._id).setOptions(cross))!.status).toBe('pending');
      expect(ctx.services.stripe.calls).toHaveLength(callsBefore);

      expect((await postEvent(ctx.app, owner.ownerId, secret, piSucceeded(payment))).status).toBe(200);
      expect((await bookingOf(bookingId)).status).toBe('confirmed');
      expect(await locksOf(bookingId)).toBe(1);
      expect(await Refund.countDocuments({ ownerId: owner.ownerId })).toBe(0);
    });

    it('refunds it when someone else took the slot in between', async () => {
      const { bookingId, payment } = await intentHold();
      ctx.services.clock.advance(11 * MIN);
      expect(await expireHolds(now())).toBe(1);
      await bookAs((await newPlayer()).token);

      expect((await postEvent(ctx.app, owner.ownerId, secret, piSucceeded(payment))).status).toBe(200);
      expect((await bookingOf(bookingId)).status).toBe('expired');
      const rows = await Refund.find({ ownerId: owner.ownerId }).lean();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ reason: 'late_payment', amount: payment.amount });
    });
  });
});

describe('autoRejectPending', () => {
  it('a pending booking is auto-rejected at the owner threshold', async () => {
    await setup({});
    const booking = await bookAs(null, '18:00');
    expect(booking.status).toBe('pending');
    const start = await startOf(booking.id);

    advanceTo(new Date(start.getTime() - 2 * HOUR - MIN));
    expect(await autoRejectPending(now())).toBe(0);
    expect((await bookingOf(booking.id)).status).toBe('pending');
    expect(await locksOf(booking.id)).toBe(1);

    ctx.services.clock.advance(MIN);
    expect(await autoRejectPending(now())).toBe(1);
    expect(await bookingOf(booking.id)).toMatchObject({ status: 'rejected', rejectReason: 'Not confirmed in time' });
    expect(await locksOf(booking.id)).toBe(0);
    const rejected = await notices('booking_rejected');
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]!.bookingId)).toBe(booking.id);
    expect(rejected[0]!.data).toMatchObject({ reason: 'Not confirmed in time' });
    const logs = await ActivityLog.find({ ownerId: owner.ownerId, action: 'booking.rejected' }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorId).toBeNull();

    // An owner who set 0 hours keeps pending bookings until they start.
    await Owner.updateOne({ _id: owner.ownerId }, { $set: { 'settings.pendingAutoRejectHours': 0 } });
    const late = await bookAs(null, '20:00');
    const lateStart = await startOf(late.id);
    advanceTo(new Date(lateStart.getTime() - MIN));
    expect(await autoRejectPending(now())).toBe(0);
    expect((await bookingOf(late.id)).status).toBe('pending');
    ctx.services.clock.advance(MIN);
    expect(await autoRejectPending(now())).toBe(1);
    expect((await bookingOf(late.id)).status).toBe('rejected');
  });

  it('auto-reject and a staff confirm racing: one wins', async () => {
    await setup({});
    const booking = await bookAs(null, '18:00');
    advanceTo(new Date((await startOf(booking.id)).getTime() - 2 * HOUR));
    const token = await ownerToken();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const [sweep, confirm] = await Promise.allSettled([
        autoRejectPending(now()),
        asOwner(token, `/bookings/${booking.id}/confirm`).send({}),
      ]);
      expect(sweep.status).toBe('fulfilled');
      expect(confirm.status).toBe('fulfilled');
      const swept = (sweep as PromiseFulfilledResult<number>).value;
      const res = (confirm as PromiseFulfilledResult<request.Response>).value;

      const final = (await bookingOf(booking.id)).status;
      expect(['rejected', 'confirmed']).toContain(final);
      const rejected = await notices('booking_rejected');
      const confirmed = await notices('booking_confirmed');
      expect(rejected.length + confirmed.length).toBe(1);
      if (final === 'rejected') {
        expect(rejected).toHaveLength(1);
        expect(swept).toBe(1);
        expect(res.status).toBe(409);
      } else {
        expect(confirmed).toHaveLength(1);
        expect(res.status).toBe(200);
        expect(swept).toBe(0);
      }
      // The loser is skipped quietly, not logged as a failure.
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});

describe('autoCompleteBookings', () => {
  it('confirmed bookings complete after their end time', async () => {
    const hold = await intentHold('17:00');
    await setup({});
    const confirmed = await bookAs((await newPlayer()).token, '18:00');
    expect(confirmed.status).toBe('confirmed');
    const pending = await bookAs(null, '19:00');
    expect(pending.status).toBe('pending');
    const end = (await bookingOf(confirmed.id)).endAt;

    advanceTo(new Date(end.getTime() - MIN));
    expect(await autoCompleteBookings(now())).toBe(0);
    expect((await bookingOf(confirmed.id)).status).toBe('confirmed');

    advanceTo((await bookingOf(pending.id)).endAt);
    expect(await autoCompleteBookings(now())).toBe(1);
    expect((await bookingOf(confirmed.id)).status).toBe('completed');
    expect((await bookingOf(pending.id)).status).toBe('pending');
    expect((await bookingOf(hold.bookingId)).status).toBe('awaiting_payment');
    const logs = await ActivityLog.find({ ownerId: owner.ownerId, action: 'booking.completed' }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorId).toBeNull();
    expect(await autoCompleteBookings(now())).toBe(0);
  });
});

describe('sendReminders', () => {
  it('a reminder is enqueued once inside the two-hour window', async () => {
    await setup({});
    const player = await newPlayer({ phone: '+8801722222222' });
    const booking = await bookAs(player.token, '18:00');
    expect(booking.status).toBe('confirmed');
    const start = await startOf(booking.id);

    advanceTo(new Date(start.getTime() - 2 * HOUR - MIN));
    expect(await sendReminders(now())).toBe(0);
    expect(await notices('booking_reminder')).toHaveLength(0);

    ctx.services.clock.advance(MIN);
    expect(await sendReminders(now())).toBe(1);
    ctx.services.clock.advance(30 * MIN);
    expect(await sendReminders(now())).toBe(0);
    const rows = await notices('booking_reminder');
    expect(rows.map((r) => r.channel).sort()).toEqual(['email', 'sms']);
    expect(rows.every((r) => String(r.bookingId) === booking.id)).toBe(true);

    advanceTo(start);
    expect(await sendReminders(now())).toBe(0);
  });

  it('a booking made inside the window gets no reminder', async () => {
    await setup({});
    advanceTo(new Date(new Date(at('18:00')).getTime() - HOUR));
    const booking = await bookAs((await newPlayer()).token, '18:00');
    expect(booking.status).toBe('confirmed');
    expect(await sendReminders(now())).toBe(0);
    expect(await notices('booking_reminder')).toHaveLength(0);
  });
});

describe('warnExpiringHolds', () => {
  it('a payment-link hold is warned ten minutes before expiry; an in-app hold is not', async () => {
    const walkin = await asOwner(owner.token, `/venues/${venueId}/turfs/${turfId}/bookings`).send({
      date: D, startAts: [at('18:00')], customer: { name: 'Walk In', phone: PHONE }, payment: { method: 'link' },
    });
    expect(walkin.status).toBe(201);
    const linkId = walkin.body.booking.id as string;
    const linkExpires = (await bookingOf(linkId)).holdExpiresAt!;
    // The in-app hold lapses in 10 minutes, already inside the warning window.
    const inApp = await intentHold('19:00');

    expect(await warnExpiringHolds(now())).toBe(0);

    advanceTo(new Date(linkExpires.getTime() - 10 * MIN - MIN));
    expect(await warnExpiringHolds(now())).toBe(0);

    ctx.services.clock.advance(MIN);
    expect(await warnExpiringHolds(now())).toBe(1);
    expect(await warnExpiringHolds(now())).toBe(0);
    const rows = await notices('hold_expiring');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: 'sms', to: PHONE });
    expect(String(rows[0]!.bookingId)).toBe(linkId);
    expect(rows[0]!.data).toMatchObject({ holdExpiresAt: linkExpires.toISOString() });
    expect(rows.some((r) => String(r.bookingId) === inApp.bookingId)).toBe(false);

    advanceTo(linkExpires);
    expect(await warnExpiringHolds(now())).toBe(0);
  });
});
