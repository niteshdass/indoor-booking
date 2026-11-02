import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { signAccessToken } from '../../src/auth/jwt';
import { seedOwner, bearer } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
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
import { Notification } from '../../src/notifications/notification.model';
import { renderNotice } from '../../src/notifications/templates';
import { sendReminders } from '../../src/jobs/sweeps';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Booking.init(), SlotLock.init(), Payment.init(), Notification.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const TZ = 'Asia/Dhaka';
// The clock starts 2026-01-01T00:00Z; the bookings are on the 5th, over 96 hours later.
const D = '2026-01-05';
const D2 = '2026-01-06';
const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '23:00' }]),
);
const at = (hm: string, date = D) => localToUtc(date, hmToMin(hm), TZ).toISOString();
const cross = { crossTenant: true };
const HOUR = 3_600_000;

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let slug: string;
let venueId: string;
let turfId: string;
let otherTurfId: string;

async function setup(settings: Record<string, unknown> = {}) {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Booking, SlotLock, Payment, Notification].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
  const venue = await seedVenue(owner.ownerId, {
    published: true,
    slug: `arena-${Math.random().toString(36).slice(2, 8)}`,
    timezone: TZ,
    settings: { hours: HOURS, bookingWindowDays: 365, ...settings },
  });
  // 5000 a slot, 8000 from 20:00.
  const pricing = { base: 5000, rules: [{ kind: 'weekday' as const, range: { start: '20:00', end: '23:00' }, price: 8000 }] };
  const turf = await seedTurf(owner.ownerId, venue.id as string, { name: 'Court 1', pricing });
  const other = await seedTurf(owner.ownerId, venue.id as string, { name: 'Court 2', pricing: { base: 9000, rules: [] } });
  slug = venue.slug;
  venueId = venue.id as string;
  turfId = turf.id as string;
  otherTurfId = other.id as string;
}

beforeEach(() => setup());

type Player = { userId: string; token: string };
async function newPlayer(): Promise<Player> {
  const u = await User.create({ name: 'Player', email: `p${Math.random()}@test.local`, emailVerified: true });
  return { userId: u.id as string, token: await signAccessToken(u.id as string, ctx.config.jwtSecret, ctx.services.now()) };
}

async function book(player: Player, starts: string[] = [at('18:00')]) {
  const res = await request(ctx.app)
    .post(`/api/v1/venues/${slug}/turfs/${turfId}/bookings`)
    .set(...bearer(player.token))
    .send({ date: D, startAts: starts });
  expect(res.status).toBe(201);
  return res.body.booking as { id: string; status: string };
}

// Signed at call time: the tests move the clock past a token's lifetime.
const tokenOf = (userId: string) => signAccessToken(userId, ctx.config.jwtSecret, ctx.services.now());
const move = async (player: Player, id: string, body: Record<string, unknown>) =>
  request(ctx.app).post(`/api/v1/me/bookings/${id}/reschedule`).set(...bearer(await tokenOf(player.userId))).send(body);
const staffMove = async (id: string, body: Record<string, unknown>) =>
  request(ctx.app)
    .post(`/api/v1/owners/${owner.ownerId}/bookings/${id}/reschedule`)
    .set(...bearer(await tokenOf(owner.userId)))
    .send(body);
const bookingOf = async (id: string) => (await Booking.findById(id).setOptions(cross))!;
const locksOf = async (id: string) =>
  (await SlotLock.find({ ownerId: owner.ownerId, bookingId: id }).sort({ startAt: 1 })).map((l) => [String(l.turfId), l.startAt.toISOString()]);
const notices = (event: string) => Notification.find({ ownerId: owner.ownerId, event }).setOptions(cross).lean();

describe('player reschedule', () => {
  it('moves the booking, swaps the slot locks and keeps the price', async () => {
    const player = await newPlayer();
    const b = await book(player);
    const before = await bookingOf(b.id);
    expect(before.policySnapshot.reschedule).toEqual({ allowed: true, minHoursBefore: 24, maxMoves: 1 });

    const res = await move(player, b.id, { date: D2, startAts: [at('10:00', D2)] });
    expect(res.status).toBe(200);
    expect(res.body.booking.slots[0].startAt).toBe(at('10:00', D2));
    expect(res.body.booking.businessDate).toBe(D2);
    expect(res.body.booking.total).toBe(5000);
    expect(res.body.booking.rescheduleCount).toBe(1);
    expect(res.body.booking.reschedulableUntil).toBeNull();

    const after = await bookingOf(b.id);
    expect(after.status).toBe(before.status);
    expect(after.playerMoves).toBe(1);
    expect(await locksOf(b.id)).toEqual([[turfId, at('10:00', D2)]]);
    const log = await ActivityLog.findOne({ ownerId: owner.ownerId, action: 'booking.rescheduled' }).setOptions(cross);
    expect(log!.before).toMatchObject({ startAt: at('18:00') });
    expect(log!.after).toMatchObject({ startAt: at('10:00', D2), by: 'player' });
    expect(await notices('booking_rescheduled')).toHaveLength(1);
    expect(await notices('staff_booking_rescheduled')).toHaveLength(1);
  });

  it('frees the old slot for someone else', async () => {
    const player = await newPlayer();
    const b = await book(player);
    expect((await move(player, b.id, { date: D, startAts: [at('12:00')] })).status).toBe(200);
    await book(await newPlayer(), [at('18:00')]);
  });

  it('can shift onto slots overlapping its own', async () => {
    const player = await newPlayer();
    const b = await book(player, [at('16:00'), at('17:00')]);
    const res = await move(player, b.id, { date: D, startAts: [at('17:00'), at('18:00')] });
    expect(res.status).toBe(200);
    expect(await locksOf(b.id)).toEqual([[turfId, at('17:00')], [turfId, at('18:00')]]);
    expect(res.body.booking.subtotal).toBe(10000);
  });

  it('shows until when it can be moved', async () => {
    const player = await newPlayer();
    const b = await book(player);
    const res = await request(ctx.app).get(`/api/v1/me/bookings/${b.id}`).set(...bearer(player.token));
    expect(res.body.booking.reschedulableUntil).toBe(new Date(Date.parse(at('18:00')) - 24 * HOUR).toISOString());
  });

  it('refuses a taken slot, a different length, the same time, a pricier slot and another court', async () => {
    const player = await newPlayer();
    const b = await book(player);
    await book(await newPlayer(), [at('12:00')]);
    expect((await move(player, b.id, { date: D, startAts: [at('12:00')] })).body.error.code).toBe('slot_unavailable');
    expect((await move(player, b.id, { date: D, startAts: [at('12:00'), at('13:00')] })).body.error.code).toBe('slot_unavailable');
    expect((await move(player, b.id, { date: D, startAts: [at('13:00'), at('14:00')] })).body.error.code).toBe('reschedule_length');
    expect((await move(player, b.id, { date: D, startAts: [at('18:00')] })).body.error.code).toBe('reschedule_same_slots');
    expect((await move(player, b.id, { date: D, startAts: [at('21:00')] })).body.error.code).toBe('reschedule_price_higher');
    expect((await bookingOf(b.id)).startAt.toISOString()).toBe(at('18:00'));
  });

  it('allows one move by default, then refuses', async () => {
    const player = await newPlayer();
    const b = await book(player);
    expect((await move(player, b.id, { date: D, startAts: [at('12:00')] })).status).toBe(200);
    const again = await move(player, b.id, { date: D, startAts: [at('13:00')] });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('reschedule_limit');
  });

  it('refuses after the cutoff', async () => {
    const player = await newPlayer();
    const b = await book(player);
    ctx.services.clock.advance(Date.parse(at('18:00')) - ctx.services.now().getTime() - 23 * HOUR);
    const res = await move(player, b.id, { date: D2, startAts: [at('10:00', D2)] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('reschedule_too_late');
  });

  it('refuses when the venue turns moves off, frozen at booking time', async () => {
    await setup({ reschedule: { allowed: false, minHoursBefore: 0, maxMoves: 1 } });
    const player = await newPlayer();
    const b = await book(player);
    const res = await move(player, b.id, { date: D, startAts: [at('12:00')] });
    expect(res.body.error.code).toBe('reschedule_not_allowed');
    // Turning it on later does not change a booking already made.
    await Venue.updateOne({ _id: venueId }, { $set: { 'settings.reschedule': { allowed: true, minHoursBefore: 0, maxMoves: 1 } } }).setOptions(cross);
    expect((await move(player, b.id, { date: D, startAts: [at('12:00')] })).body.error.code).toBe('reschedule_not_allowed');
  });

  it('refuses a booking made before the policy existed and someone else’s booking', async () => {
    const player = await newPlayer();
    const b = await book(player);
    await Booking.updateOne({ _id: b.id }, { $set: { 'policySnapshot.reschedule': null } }).setOptions(cross);
    expect((await move(player, b.id, { date: D, startAts: [at('12:00')] })).body.error.code).toBe('reschedule_not_allowed');
    expect((await move(await newPlayer(), b.id, { date: D, startAts: [at('12:00')] })).status).toBe(404);
  });

  it('refuses a cancelled booking', async () => {
    const player = await newPlayer();
    const b = await book(player);
    expect((await request(ctx.app).post(`/api/v1/me/bookings/${b.id}/cancel`).set(...bearer(player.token)).send({})).status).toBe(200);
    expect((await move(player, b.id, { date: D, startAts: [at('12:00')] })).body.error.code).toBe('invalid_transition');
  });
});

describe('staff reschedule', () => {
  it('moves to another court and pricier slots at the same price, and tells the player', async () => {
    const player = await newPlayer();
    const b = await book(player);
    const res = await staffMove(b.id, { turfId: otherTurfId, date: D, startAts: [at('21:00')] });
    expect(res.status).toBe(200);
    expect(res.body.booking.turfId).toBe(otherTurfId);
    expect(res.body.booking.total).toBe(5000);
    expect(res.body.booking.slots[0].price).toBe(5000);
    expect(await locksOf(b.id)).toEqual([[otherTurfId, at('21:00')]]);
    expect((await bookingOf(b.id)).playerMoves).toBe(0);
    expect(await notices('booking_rescheduled')).toHaveLength(1);
    expect(await notices('staff_booking_rescheduled')).toHaveLength(0);
  });

  it('moves after the player cutoff and more than once', async () => {
    const player = await newPlayer();
    const b = await book(player);
    ctx.services.clock.advance(Date.parse(at('18:00')) - ctx.services.now().getTime() - HOUR);
    expect((await staffMove(b.id, { date: D, startAts: [at('19:00')] })).status).toBe(200);
    expect((await staffMove(b.id, { date: D, startAts: [at('20:00')] })).status).toBe(200);
    expect((await bookingOf(b.id)).rescheduleCount).toBe(2);
    // One notice per move.
    expect(await notices('booking_rescheduled')).toHaveLength(2);
  });

  it('moves a booking made before moves existed', async () => {
    const player = await newPlayer();
    const b = await book(player);
    // Rows from before P2-05 have none of the move fields or the policy.
    await Booking.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(b.id) },
      { $unset: { rescheduleCount: '', playerMoves: '', rescheduledAt: '', 'policySnapshot.reschedule': '' } },
    );
    const res = await staffMove(b.id, { date: D, startAts: [at('12:00')] });
    expect(res.status).toBe(200);
    expect((await bookingOf(b.id)).rescheduleCount).toBe(1);
    expect((await staffMove(b.id, { date: D, startAts: [at('13:00')] })).status).toBe(200);
  });

  it('needs booking.reschedule', async () => {
    const player = await newPlayer();
    const b = await book(player);
    const staffRole = await Role.findOne({ key: 'staff' }).setOptions(cross);
    await Membership.updateOne({ ownerId: owner.ownerId, userId: owner.userId }, { $set: { roleId: staffRole!._id } }).setOptions(cross);
    const res = await staffMove(b.id, { date: D, startAts: [at('12:00')] });
    expect(res.status).toBe(403);
  });
});

describe('reminders', () => {
  it('a moved booking is reminded again of its new time', async () => {
    const player = await newPlayer();
    const b = await book(player);
    await Booking.updateOne({ _id: b.id }, { $set: { status: 'confirmed' } }).setOptions(cross);
    ctx.services.clock.advance(Date.parse(at('18:00')) - ctx.services.now().getTime() - HOUR);
    expect(await sendReminders(ctx.services.now())).toBe(1);
    expect((await staffMove(b.id, { date: D, startAts: [at('20:00')] })).status).toBe(200);
    ctx.services.clock.advance(2 * HOUR);
    expect(await sendReminders(ctx.services.now())).toBe(1);
    const rows = await notices('booking_reminder');
    expect(rows.map((r) => (r.data as { startAt: string }).startAt).sort()).toEqual([at('18:00'), at('20:00')]);
  });
});

describe('notice templates', () => {
  it('names the old time in every locale', () => {
    const d = {
      bookingId: 'b1', reference: 'ABC123', venueName: 'Arena', turfName: 'Court 2', timezone: TZ,
      startAt: at('21:00'), endAt: at('22:00'), currency: 'BDT',
      previousTurfName: 'Court 1', previousStartAt: at('18:00'), previousEndAt: at('19:00'), customerName: 'Rafi',
    };
    for (const locale of ['en', 'ru', 'bn'] as const) {
      const player = renderNotice('booking_rescheduled', locale, d, 'https://app');
      expect(player.text).toContain('Court 1');
      expect(player.sms).toContain('ABC123');
      const staff = renderNotice('staff_booking_rescheduled', locale, d, 'https://app');
      expect(staff.text).toContain('Rafi');
      expect(staff.sms).toContain('https://app/dashboard/bookings/b1');
    }
  });
});
