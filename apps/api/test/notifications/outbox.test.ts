import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { makeTestServices, type TestServices } from '../helpers/testServices';
import { testConfig } from '../helpers/testApp';
import { seedOwner, addMember } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Booking, type BookingDoc } from '../../src/bookings/booking.model';
import { Notification } from '../../src/notifications/notification.model';
import { DELIVER_BUDGET_MS, deliverNotifications, noticeBooking } from '../../src/notifications/outbox';
import { runInTransaction } from '../../src/db';
import type { NoticeEvent } from '../../src/notifications/templates';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init(), Turf.init(), Booking.init(), Notification.init()]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const cross = { crossTenant: true };
const MIN = 60_000;

let services: TestServices;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let venueId: string;
let turfId: string;
let seq = 0;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[Venue, Turf, Booking, Notification].map((m) => (m as typeof Venue).deleteMany({}).setOptions(cross)),
  ]);
  services = makeTestServices();
  owner = await seedOwner(services);
  venueId = (await seedVenue(owner.ownerId)).id as string;
  turfId = (await seedTurf(owner.ownerId, venueId)).id as string;
});

async function seedBooking(over: Record<string, unknown> = {}): Promise<BookingDoc> {
  seq += 1;
  const startAt = new Date('2026-01-05T12:00:00Z');
  const endAt = new Date('2026-01-05T13:00:00Z');
  return Booking.create({
    ownerId: owner.ownerId,
    venueId,
    turfId,
    reference: `REF${seq}`,
    businessDate: '2026-01-05',
    startAt,
    endAt,
    slots: [{ startAt, endAt, price: 5000 }],
    currency: 'BDT',
    subtotal: 5000,
    addonsTotal: 0,
    total: 5000,
    advanceRequired: 0,
    status: 'confirmed',
    paymentStatus: 'unpaid',
    source: 'online',
    policySnapshot: {},
    ...over,
  });
}

const notice = (event: NoticeEvent, booking: BookingDoc, extra?: Parameters<typeof noticeBooking>[4]) =>
  runInTransaction((s) => noticeBooking(event, booking, services.now(), s, extra));
const rows = () => Notification.find({}).setOptions(cross).sort({ _id: 1 });
const deliver = () => deliverNotifications(services.now(), { config: testConfig, services });

async function player(over: Record<string, unknown> = {}) {
  seq += 1;
  return User.create({ name: 'Pat Player', email: `pat${seq}@x.test`, emailVerified: true, phone: `+88017000${seq}`, phoneVerified: true, ...over });
}

describe('noticeBooking recipients', () => {
  it('a registered player with verified email and phone gets both channels', async () => {
    const p = await player();
    const booking = await seedBooking({ playerId: p._id });
    expect(await notice('booking_confirmed', booking)).toBe(2);
    expect((await rows()).map((r) => r.channel).sort()).toEqual(['email', 'sms']);
  });

  it('unverified contacts are skipped', async () => {
    const p = await player({ emailVerified: false });
    const booking = await seedBooking({ playerId: p._id });
    expect(await notice('booking_confirmed', booking)).toBe(1);
    const [row] = await rows();
    expect(row).toMatchObject({ channel: 'sms', to: p.phone, status: 'pending', locale: 'en' });
  });

  it('a guest booking notifies the guest phone by sms', async () => {
    const booking = await seedBooking({ guest: { name: 'Gus', phone: '+8801811111111' } });
    await notice('booking_confirmed', booking);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ channel: 'sms', to: '+8801811111111' });
    expect(all[0]!.data).toMatchObject({ customerName: 'Gus', venueName: expect.any(String) });
  });

  it('staff_new_pending goes to members who can confirm at that venue', async () => {
    const otherVenue = (await seedVenue(owner.ownerId)).id as string;
    const manager = await addMember(services, owner.ownerId, { roleKey: 'manager', venueIds: 'all' });
    const scoped = await addMember(services, owner.ownerId, { roleKey: 'manager', venueIds: [venueId] });
    await addMember(services, owner.ownerId, { roleKey: 'staff', venueIds: 'all' });
    await addMember(services, owner.ownerId, { roleKey: 'manager', venueIds: [otherVenue] });
    await addMember(services, owner.ownerId, { roleKey: 'manager', venueIds: 'all', status: 'disabled' });
    const booking = await seedBooking({ guest: { name: 'Gus', phone: '+8801811111111' } });
    // A phone-only member is reached by sms.
    const phoneOnly = await addMember(services, owner.ownerId, { roleKey: 'manager', venueIds: 'all' });
    await User.updateOne({ _id: phoneOnly.userId }, { $unset: { email: 1 }, $set: { phone: '+8801955555555' } });

    expect(await notice('staff_new_pending', booking)).toBe(4);
    const all = await rows();
    const emails = (await User.find({ _id: { $in: [owner.userId, manager.userId, scoped.userId] } })).map((u) => u.email).sort();
    expect(all.filter((r) => r.channel === 'email').map((r) => r.to).sort()).toEqual(emails);
    expect(all.filter((r) => r.channel === 'sms').map((r) => r.to)).toEqual(['+8801955555555']);
  });

  it('the same event twice inserts once', async () => {
    const p = await player();
    const booking = await seedBooking({ playerId: p._id });
    expect(await notice('booking_confirmed', booking)).toBe(2);
    expect(await notice('booking_confirmed', booking)).toBe(0);
    expect(await rows()).toHaveLength(2);
    // A different refund is a different notice.
    expect(await notice('refund_issued', booking, { amount: 100, refundId: 'r1' })).toBe(2);
    expect(await notice('refund_issued', booking, { amount: 100, refundId: 'r2' })).toBe(2);
  });
});

describe('deliverNotifications', () => {
  it('sends and marks rows sent', async () => {
    const booking = await seedBooking({ guest: { name: 'Gus', phone: '+8801811111111' } });
    await notice('booking_confirmed', booking);
    expect(await deliver()).toEqual({ sent: 1, failed: 0, dropped: 0 });
    expect(services.sms.sent).toHaveLength(1);
    expect(services.sms.sent[0]!.to).toBe('+8801811111111');
    expect(services.sms.sent[0]!.text).toContain(booking.reference);
    const [row] = await rows();
    expect(row).toMatchObject({ status: 'sent', attempts: 1 });
    expect(row!.sentAt).toEqual(services.now());
    expect(await deliver()).toEqual({ sent: 0, failed: 0, dropped: 0 });
  });

  it('sends email with subject and text', async () => {
    const p = await player({ phoneVerified: false });
    const booking = await seedBooking({ playerId: p._id });
    await notice('booking_confirmed', booking);
    await deliver();
    expect(services.email.sent).toHaveLength(1);
    expect(services.email.sent[0]).toMatchObject({ to: p.email, subject: expect.stringContaining(booking.reference) });
  });

  it('a failing provider is retried with backoff and fails after 5 attempts', async () => {
    const bad = await seedBooking({ guest: { name: 'Bad', phone: '+8801800000001' } });
    const good = await seedBooking({ guest: { name: 'Good', phone: '+8801800000002' } });
    await notice('booking_confirmed', bad);
    await notice('booking_confirmed', good);
    const send = services.sms.send.bind(services.sms);
    services.sms.send = async (to, text) => {
      if (to === '+8801800000001') throw new Error('provider down');
      return send(to, text);
    };

    const start = services.now();
    expect(await deliver()).toEqual({ sent: 1, failed: 1, dropped: 0 });
    const failing = () => Notification.findOne({ to: '+8801800000001' }).setOptions(cross);
    let row = (await failing())!;
    expect(row).toMatchObject({ attempts: 1, status: 'pending', lastError: 'provider down' });
    expect(row.nextAttemptAt).toEqual(new Date(start.getTime() + MIN));
    expect((await Notification.findOne({ to: '+8801800000002' }).setOptions(cross))!.status).toBe('sent');

    // Not due yet: nothing happens.
    expect(await deliver()).toEqual({ sent: 0, failed: 0, dropped: 0 });

    for (const [attempts, wait] of [[2, 2], [3, 4], [4, 8]] as const) {
      services.clock.advance((wait / 2 || 1) * MIN);
      await deliver();
      row = (await failing())!;
      expect(row).toMatchObject({ attempts, status: 'pending' });
      expect(row.nextAttemptAt).toEqual(new Date(services.now().getTime() + wait * MIN));
    }
    services.clock.advance(8 * MIN);
    await deliver();
    row = (await failing())!;
    expect(row).toMatchObject({ attempts: 5, status: 'failed', lastError: 'provider down' });
    services.clock.advance(60 * MIN);
    expect(await deliver()).toEqual({ sent: 0, failed: 0, dropped: 0 });
  });

  it('a slow provider stops the run once the time budget is spent', async () => {
    expect(DELIVER_BUDGET_MS).toBe(60_000);
    for (let i = 1; i <= 5; i += 1) await notice('booking_confirmed', await seedBooking({ guest: { name: 'G', phone: `+880180000000${i}` } }));
    const send = services.sms.send.bind(services.sms);
    services.sms.send = async (to, text) => {
      services.clock.advance(30_000);
      return send(to, text);
    };

    expect(await deliver()).toEqual({ sent: 3, failed: 0, dropped: 0 });
    const left = await Notification.find({ status: 'pending' }).setOptions(cross);
    expect(left).toHaveLength(2);
    for (const row of left) expect(row.attempts).toBe(0);
    // The next tick picks them up.
    expect(await deliver()).toEqual({ sent: 2, failed: 0, dropped: 0 });
  });

  it('a row claimed late in a slow run cannot be claimed again by another instance', async () => {
    await notice('booking_confirmed', await seedBooking({ guest: { name: 'A', phone: '+8801800000001' } }));
    await notice('booking_confirmed', await seedBooking({ guest: { name: 'B', phone: '+8801800000002' } }));
    const start = services.now();
    const send = services.sms.send.bind(services.sms);
    let calls = 0;
    const nested: Awaited<ReturnType<typeof deliver>>[] = [];
    services.sms.send = async (to, text) => {
      calls += 1;
      if (calls === 1) services.clock.advance(50_000);
      if (calls === 2) {
        // The second row was claimed at start + 50s; mid-send, another instance ticks at start + 70s.
        const claimed = (await Notification.findOne({ to }).setOptions(cross))!;
        expect(claimed.nextAttemptAt).toEqual(new Date(start.getTime() + 50_000 + MIN));
        services.clock.advance(20_000);
        nested.push(await deliverNotifications(services.now(), { config: testConfig, services }));
        // An instance whose tick time is ahead of the clock does not re-claim it either.
        nested.push(await deliverNotifications(new Date(start.getTime() + 5 * MIN), { config: testConfig, services }));
      }
      return send(to, text);
    };

    expect(await deliver()).toEqual({ sent: 2, failed: 0, dropped: 0 });
    expect(nested).toEqual([
      { sent: 0, failed: 0, dropped: 0 },
      { sent: 0, failed: 0, dropped: 0 },
    ]);
    expect(services.sms.sent).toHaveLength(2);
    expect(new Set(services.sms.sent.map((m) => m.to)).size).toBe(2);
    for (const row of await rows()) expect(row).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('a throw while rendering fails only that row', async () => {
    const bad = await seedBooking({ guest: { name: 'Bad', phone: '+8801800000001' } });
    const good = await seedBooking({ guest: { name: 'Good', phone: '+8801800000002' } });
    await notice('booking_confirmed', bad);
    await notice('booking_confirmed', good);
    await Notification.updateOne({ to: '+8801800000001' }, { $set: { 'data.timezone': 'Not/AZone' } }).setOptions(cross);
    expect(await deliver()).toEqual({ sent: 1, failed: 1, dropped: 0 });
  });

  it('a reminder for a booking no longer confirmed is dropped', async () => {
    const booking = await seedBooking({ guest: { name: 'Gus', phone: '+8801811111111' } });
    await notice('booking_reminder', booking);
    await Booking.updateOne({ ownerId: owner.ownerId, _id: booking._id }, { $set: { status: 'cancelled' } });
    expect(await deliver()).toEqual({ sent: 0, failed: 0, dropped: 1 });
    expect(services.sms.sent).toHaveLength(0);
    expect(await Notification.findOne({}).setOptions(cross)).toMatchObject({ status: 'failed', lastError: 'stale' });
  });

  it('a hold_expiring notice is dropped once the booking is paid', async () => {
    const booking = await seedBooking({ status: 'awaiting_payment', holdExpiresAt: new Date('2026-01-01T00:30:00Z'), guest: { name: 'Gus', phone: '+8801811111111' } });
    await notice('hold_expiring', booking);
    await Booking.updateOne({ ownerId: owner.ownerId, _id: booking._id }, { $set: { status: 'confirmed' } });
    expect(await deliver()).toEqual({ sent: 0, failed: 0, dropped: 1 });
  });
});
