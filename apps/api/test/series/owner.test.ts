import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { hmToMin, localToUtc, type SeriesPattern } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { signAccessToken } from '../../src/auth/jwt';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Closure } from '../../src/schedule/closure.model';
import { SlotOverride } from '../../src/schedule/slotOverride.model';
import { Booking } from '../../src/bookings/booking.model';
import { SlotLock } from '../../src/bookings/slotLock.model';
import { Payment } from '../../src/bookings/payment.model';
import { Refund } from '../../src/payments/refund.model';
import { Notification } from '../../src/notifications/notification.model';
import { RecurringSeries } from '../../src/series/series.model';
import { bookSeries, type SeriesWho } from '../../src/series/engine';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Closure.init(), SlotOverride.init(), Booking.init(), SlotLock.init(), Payment.init(), Refund.init(),
    Notification.init(), RecurringSeries.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const TZ = 'Asia/Dhaka';
const cross = { crossTenant: true };
const TUE = ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27'];
const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '23:00' }]),
);
const at = (hm: string, date: string) => localToUtc(date, hmToMin(hm), TZ);
const PHONE = '+8801711111111';

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let staff: Awaited<ReturnType<typeof addMember>>;
let manager: Awaited<ReturnType<typeof addMember>>;
let player: { userId: string; token: string; email: string };
let v1: string;
let v2: string;
let t1: string;
let t2: string;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Closure, SlotOverride, Booking, SlotLock, Payment, Refund, Notification, RecurringSeries].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  ctx = buildTestApp();
  ctx.services.clock.advance(4 * 86_400_000); // 2026-01-05T00:00Z = Monday 06:00 in Dhaka
  a = await seedOwner(ctx.services);
  const settings = { hours: HOURS, bookingWindowDays: 7 };
  v1 = (await seedVenue(a.ownerId, { timezone: TZ, published: true, slug: 'v-one', settings })).id as string;
  v2 = (await seedVenue(a.ownerId, { timezone: TZ, published: true, slug: 'v-two', settings })).id as string;
  t1 = (await seedTurf(a.ownerId, v1, { pricing: { base: 1000, rules: [] } })).id as string;
  t2 = (await seedTurf(a.ownerId, v2, { pricing: { base: 1000, rules: [] } })).id as string;
  staff = await addMember(ctx.services, a.ownerId, { roleKey: 'staff' });
  manager = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: [v1] });
  const u = await User.create({ name: 'Rahim', email: `p${Math.random()}@test.local`, emailVerified: true });
  player = { userId: u.id as string, email: u.email!, token: '' };
  await resign();
});

async function resign() {
  for (const m of [a, staff, manager, player]) m.token = await signAccessToken(m.userId, ctx.config.jwtSecret, ctx.services.now());
}
/** Moves the clock and re-issues the access tokens, which would otherwise expire. */
async function setClock(iso: string) {
  ctx.services.clock.advance(Date.parse(iso) - ctx.services.now().getTime());
  await resign();
}

const api = () => request(ctx.app);
const url = (rest: string) => `/api/v1/owners/${a.ownerId}${rest}`;
const post = (path: string, token: string, body: object = {}) => api().post(url(path)).set(...bearer(token)).send(body);
const get = (path: string, token: string) => api().get(url(path)).set(...bearer(token));
const turfBase = (venueId = v1, turfId = t1) => `/venues/${venueId}/turfs/${turfId}/series`;

const pattern = (over: Partial<SeriesPattern> = {}) => ({
  weekdays: ['tue'],
  startTime: '18:00',
  slotCount: 1,
  firstDate: TUE[0]!,
  count: 4,
  ...over,
});
const groupBody = (over: Record<string, unknown> = {}) => ({
  ...pattern(),
  customer: { name: 'Команда Альфа', phone: '+880 1711-111111' },
  ...over,
});

async function docs(venueId = v1, turfId = t1) {
  const venue = (await Venue.findById(venueId).setOptions(cross))!;
  const turf = (await Turf.findById(turfId).setOptions(cross))!;
  return { venue, turf };
}

/** A player's request, waiting for an answer. */
async function seedRequest(venueId = v1, turfId = t1) {
  const { venue, turf } = await docs(venueId, turfId);
  const who: SeriesWho = { playerId: player.userId, guest: null, createdBy: player.userId };
  const out = await bookSeries({
    venue, turf, who, mode: 'request', now: ctx.services.now(),
    pattern: { weekdays: ['tue'], startTime: '18:00', slotCount: 1, firstDate: TUE[0]!, endDate: null, count: 4 },
  });
  await Notification.deleteMany({}).setOptions(cross);
  return { seriesId: out.series.id as string, gameIds: out.games.map((g) => g.id as string) };
}

async function seedBooking(date: string, hm: string) {
  const startAt = at(hm, date);
  const endAt = new Date(startAt.getTime() + 3_600_000);
  const b = await Booking.create({
    ownerId: a.ownerId, venueId: v1, turfId: t1, reference: `R${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
    businessDate: date, startAt, endAt, slots: [{ startAt, endAt, price: 1000 }], currency: 'BDT',
    subtotal: 1000, addonsTotal: 0, total: 1000, advanceRequired: 0, status: 'confirmed', paymentStatus: 'unpaid',
    source: 'online', guest: { name: 'Other', phone: '+8801722222222' },
    policySnapshot: { paymentPolicy: { type: 'none' }, refundRules: [] },
  });
  await SlotLock.create({ ownerId: a.ownerId, turfId: t1, startAt, bookingId: b._id });
  return b;
}

const notices = () => Notification.find({}).setOptions(cross).sort({ _id: 1 });

describe('owner series: validation', () => {
  it.each([
    ['empty weekdays', { weekdays: [] }],
    ['duplicate weekdays', { weekdays: ['tue', 'tue'] }],
    ['bad weekday', { weekdays: ['xyz'] }],
    ['both endDate and count', { endDate: TUE[3] }],
    ['neither endDate nor count', { count: undefined }],
    ['count 0', { count: 0 }],
    ['count 101', { count: 101 }],
    ['count not integer', { count: 2.5 }],
    ['slotCount 0', { slotCount: 0 }],
    ['slotCount 13', { slotCount: 13 }],
    ['bad startTime', { startTime: '25:00' }],
    ['bad firstDate', { firstDate: '2026-02-30' }],
    ['unknown key', { extra: 1 }],
  ])('rejects %s with 400 validation_error', async (_name, over) => {
    const res = await post(`${turfBase()}/preview`, a.token, { ...pattern(), ...over });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('accepts endDate instead of count, and null for the other', async () => {
    const res = await post(`${turfBase()}/preview`, a.token, { ...pattern({ count: null, endDate: TUE[1] }) });
    expect(res.status).toBe(200);
    expect(res.body.preview.dates.map((d: { date: string }) => d.date)).toEqual([TUE[0], TUE[1]]);
  });

  it('create needs a customer', async () => {
    const res = await post(turfBase(), a.token, pattern());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});

describe('owner series: preview and create', () => {
  it('preview and create a series for a guest group', async () => {
    await seedBooking(TUE[1]!, '18:00');
    const preview = await post(`${turfBase()}/preview`, staff.token, pattern());
    expect(preview.status).toBe(200);
    expect(preview.body.preview.dates.map((d: { date: string; status: string }) => [d.date, d.status])).toEqual([
      [TUE[0], 'free'], [TUE[1], 'clash'], [TUE[2], 'free'], [TUE[3], 'free'],
    ]);

    const res = await post(turfBase(), staff.token, groupBody());
    expect(res.status).toBe(201);
    const s = res.body.series;
    expect(s).toMatchObject({
      venueId: v1, turfId: t1, status: 'active', source: 'walkin', player: null,
      guest: { name: 'Команда Альфа', phone: PHONE },
      pattern: { weekdays: ['tue'], startTime: '18:00', slotCount: 1, firstDate: TUE[0], endDate: null, count: 4 },
      skipped: [{ date: TUE[1], reason: 'taken' }],
    });
    const free = preview.body.preview.dates.filter((d: { status: string }) => d.status === 'free');
    expect(s.games.map((g: { businessDate: string }) => g.businessDate)).toEqual(free.map((d: { date: string }) => d.date));
    expect(s.games.every((g: { status: string }) => g.status === 'confirmed')).toBe(true);

    const rows = await notices();
    expect(rows.map((r) => [r.event, r.channel, r.to])).toEqual([['series_created', 'sms', PHONE]]);
    expect(rows[0]!.data).toMatchObject({ seriesId: s.id, skipped: [{ date: TUE[1], reason: 'taken' }] });
    expect((rows[0]!.data as { games: string[] }).games).toHaveLength(3);

    const log = await ActivityLog.findOne({ ownerId: a.ownerId, action: 'series.create' }).lean();
    expect(log).toMatchObject({ entity: 'series', entityId: expect.anything() });
    expect(String(log!.entityId)).toBe(s.id);
    expect(String(log!.actorId)).toBe(staff.userId);
    expect(await ActivityLog.countDocuments({ ownerId: a.ownerId, action: 'booking.create' })).toBe(0);
  });

  it('create for a registered player links playerId and the games show in their /me/bookings with seriesId', async () => {
    const res = await post(turfBase(), a.token, groupBody({ customer: { name: 'Rahim', phone: PHONE, playerId: player.userId } }));
    expect(res.status).toBe(201);
    expect(res.body.series.player).toEqual({ id: player.userId, name: 'Rahim' });
    const mine = await api().get('/api/v1/me/bookings').set(...bearer(player.token));
    expect(mine.body.bookings).toHaveLength(4);
    expect(mine.body.bookings.every((b: { seriesId: string; playerId: string }) => b.seriesId === res.body.series.id && b.playerId === player.userId)).toBe(true);

    const bad = await post(turfBase(), a.token, groupBody({ customer: { name: 'X', phone: PHONE, playerId: 'nope' } }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('player_not_found');
  });

  it('pattern errors and a full calendar map to their codes', async () => {
    const past = await post(turfBase(), a.token, groupBody({ firstDate: '2026-01-01' }));
    expect(past.body.error.code).toBe('series_past_start');
    for (const d of TUE) await seedBooking(d, '18:00');
    const none = await post(turfBase(), a.token, groupBody());
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe('series_no_free_dates');
    expect(await RecurringSeries.countDocuments({}).setOptions(cross)).toBe(0);
  });
});

describe('owner series: scope', () => {
  it("staff without booking.create gets 403; venue-scoped manager gets 404 for another venue's turf, series detail, accept and cancel-future, and the list omits it", async () => {
    const role = await Role.create({ ownerId: a.ownerId, name: 'Viewer', permissions: ['booking.view'] });
    const viewer = await addMember(ctx.services, a.ownerId, { roleId: role.id as string });
    expect((await post(`${turfBase()}/preview`, viewer.token, pattern())).status).toBe(403);
    expect((await post(turfBase(), viewer.token, groupBody())).status).toBe(403);

    const other = await seedRequest(v2, t2);
    const own = await seedRequest(v1, t1);
    for (const res of [
      await post(`${turfBase(v2, t2)}/preview`, manager.token, pattern()),
      await post(turfBase(v2, t2), manager.token, groupBody()),
      await get(`/series/${other.seriesId}`, manager.token),
      await post(`/series/${other.seriesId}/accept`, manager.token),
      await post(`/series/${other.seriesId}/decline`, manager.token),
      await post(`/series/${other.seriesId}/cancel-future`, manager.token),
      await get('/series/not-an-id', manager.token),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    }
    expect((await RecurringSeries.findById(other.seriesId).setOptions(cross))!.status).toBe('requested');

    const list = await get('/series', manager.token);
    expect(list.status).toBe(200);
    expect(list.body.series.map((s: { id: string }) => s.id)).toEqual([own.seriesId]);
    expect((await get(`/series?venueId=${v2}`, manager.token)).status).toBe(404);
    const all = await get('/series', a.token);
    expect(all.body.series.map((s: { id: string }) => s.id)).toEqual([own.seriesId, other.seriesId]);
  });
});

describe('owner series: list and detail', () => {
  it('lists newest first with games, filters, and pages by before', async () => {
    const first = await seedRequest();
    const second = (await post(turfBase(), a.token, groupBody({ startTime: '20:00' }))).body.series.id as string;
    const all = await get('/series', staff.token);
    expect(all.body.series.map((s: { id: string }) => s.id)).toEqual([second, first.seriesId]);
    expect(all.body.series[1].games).toHaveLength(4);
    expect(all.body.series[1].player).toEqual({ id: player.userId, name: 'Rahim' });
    expect(all.body.nextBefore).toBeNull();

    const requested = await get(`/series?status=requested&venueId=${v1}`, staff.token);
    expect(requested.body.series.map((s: { id: string }) => s.id)).toEqual([first.seriesId]);
    const older = await get(`/series?before=${second}`, staff.token);
    expect(older.body.series.map((s: { id: string }) => s.id)).toEqual([first.seriesId]);
    expect((await get('/series?status=bogus', staff.token)).status).toBe(400);

    const one = await get(`/series/${first.seriesId}`, staff.token);
    expect(one.status).toBe(200);
    expect(one.body.series).toMatchObject({ id: first.seriesId, status: 'requested' });
    expect(one.body.series.games).toHaveLength(4);
  });
});

describe('owner series: paging', () => {
  it('pages 50 at a time with nextBefore', async () => {
    const at0 = at('18:00', TUE[0]!);
    await RecurringSeries.insertMany(
      Array.from({ length: 51 }, () => ({
        ownerId: a.ownerId, venueId: v1, turfId: t1, source: 'walkin', guest: { name: 'G', phone: PHONE },
        weekdays: ['tue'], startTime: '18:00', slotCount: 1, firstDate: TUE[0], count: 1, status: 'active',
        currency: 'BDT', firstStartAt: at0, lastEndAt: new Date(at0.getTime() + 3_600_000),
      })),
    );
    const ids = (await RecurringSeries.find({}).setOptions(cross).sort({ _id: -1 })).map((x) => String(x._id));
    const one = await get('/series', a.token);
    expect(one.body.series.map((x: { id: string }) => x.id)).toEqual(ids.slice(0, 50));
    expect(one.body.nextBefore).toBe(ids[49]);
    const two = await get(`/series?before=${one.body.nextBefore}`, a.token);
    expect(two.body.series.map((x: { id: string }) => x.id)).toEqual(ids.slice(50));
    expect(two.body.nextBefore).toBeNull();
  });
});

describe('owner series: answering', () => {
  it('accept confirms every pending game and sends one series_accepted', async () => {
    const { seriesId, gameIds } = await seedRequest();
    const res = await post(`/series/${seriesId}/accept`, manager.token);
    expect(res.status).toBe(200);
    expect(res.body.series.status).toBe('active');
    expect(res.body.series.games.map((g: { status: string }) => g.status)).toEqual(['confirmed', 'confirmed', 'confirmed', 'confirmed']);
    const s = (await RecurringSeries.findById(seriesId).setOptions(cross))!;
    expect(String(s.decidedBy)).toBe(manager.userId);
    expect(s.decidedAt).toEqual(ctx.services.now());

    const rows = await notices();
    expect(rows.map((r) => [r.event, r.to])).toEqual([['series_accepted', player.email]]);
    expect(String(rows[0]!.bookingId)).toBe(gameIds[0]);
    expect(await ActivityLog.countDocuments({ ownerId: a.ownerId, action: 'series.accept', entityId: seriesId })).toBe(1);
    // The series row is the only record of the answer: no per-game rows, member or system.
    expect(await ActivityLog.countDocuments({ ownerId: a.ownerId, entityId: { $in: gameIds } })).toBe(0);
    expect(await ActivityLog.countDocuments({ ownerId: a.ownerId, action: /^booking\./ })).toBe(0);

    const again = await post(`/series/${seriesId}/accept`, manager.token);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('series_not_requested');
  });

  it('accept after respondBy → 409 series_not_requested; decline still works', async () => {
    const { seriesId, gameIds } = await seedRequest();
    const s = (await RecurringSeries.findById(seriesId).setOptions(cross))!;
    await setClock(s.respondBy!.toISOString());
    const late = await post(`/series/${seriesId}/accept`, a.token);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('series_not_requested');
    const games = await Booking.find({ _id: { $in: gameIds } }).setOptions(cross);
    expect(games.every((g) => g.status === 'pending')).toBe(true);
    expect((await RecurringSeries.findById(seriesId).setOptions(cross))!.status).toBe('requested');
    const declined = await post(`/series/${seriesId}/decline`, a.token);
    expect(declined.status).toBe(200);
    expect(declined.body.series.status).toBe('declined');
  });

  it('accept just before respondBy succeeds', async () => {
    const { seriesId } = await seedRequest();
    const s = (await RecurringSeries.findById(seriesId).setOptions(cross))!;
    await setClock(new Date(s.respondBy!.getTime() - 1).toISOString());
    expect((await post(`/series/${seriesId}/accept`, a.token)).status).toBe(200);
  });

  it('staff without booking.confirm cannot answer', async () => {
    const { seriesId } = await seedRequest();
    expect((await post(`/series/${seriesId}/accept`, staff.token)).status).toBe(403);
    expect((await post(`/series/${seriesId}/decline`, staff.token)).status).toBe(403);
  });

  it('decline rejects every game with the reason and frees the slots', async () => {
    const { seriesId, gameIds } = await seedRequest();
    const res = await post(`/series/${seriesId}/decline`, a.token, { reason: 'Турнир' });
    expect(res.status).toBe(200);
    expect(res.body.series).toMatchObject({ status: 'declined', declineReason: 'Турнир' });
    const games = await Booking.find({ _id: { $in: gameIds } }).setOptions(cross);
    expect(games.every((g) => g.status === 'rejected' && g.rejectReason === 'Турнир')).toBe(true);
    expect(await SlotLock.countDocuments({ bookingId: { $in: gameIds } }).setOptions(cross)).toBe(0);

    const rows = await notices();
    expect(rows.map((r) => r.event)).toEqual(['series_declined']);
    expect(rows[0]!.data).toMatchObject({ reason: 'Турнир' });
    expect(await ActivityLog.countDocuments({ ownerId: a.ownerId, action: 'series.decline' })).toBe(1);
    expect(await ActivityLog.countDocuments({ ownerId: a.ownerId, entityId: { $in: gameIds } })).toBe(0);

    await setClock('2026-01-06T00:00:00Z');
    const single = await post(`/venues/${v1}/turfs/${t1}/bookings`, a.token, {
      date: TUE[0], startAts: [at('18:00', TUE[0]!).toISOString()],
      customer: { name: 'Walk In', phone: PHONE }, payment: { method: 'unpaid' },
    });
    expect(single.status).toBe(201);

    expect((await post(`/series/${seriesId}/accept`, a.token)).body.error.code).toBe('series_not_requested');
    expect((await post(`/series/${seriesId}/decline`, a.token, { reason: 'x'.repeat(301) })).body.error.code).toBe('validation_error');
  });

  it('two accepts at once: one 200, one 409 series_not_requested', async () => {
    const { seriesId, gameIds } = await seedRequest();
    const results = await Promise.all([post(`/series/${seriesId}/accept`, a.token), post(`/series/${seriesId}/accept`, manager.token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('series_not_requested');
    const games = await Booking.find({ _id: { $in: gameIds } }).setOptions(cross);
    expect(games.every((g) => g.status === 'confirmed')).toBe(true);
    expect(await Notification.countDocuments({ event: 'series_accepted' }).setOptions(cross)).toBe(1);
  });

  it('accept and decline at once: one outcome, games match it', async () => {
    const { seriesId, gameIds } = await seedRequest();
    const results = await Promise.all([post(`/series/${seriesId}/accept`, a.token), post(`/series/${seriesId}/decline`, manager.token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const s = (await RecurringSeries.findById(seriesId).setOptions(cross))!;
    const want = s.status === 'active' ? 'confirmed' : 'rejected';
    const games = await Booking.find({ _id: { $in: gameIds } }).setOptions(cross);
    expect(games.every((g) => g.status === want)).toBe(true);
  });

  it("per-booking confirm, reject and cancel of a waiting request's game → 409 series_request_open", async () => {
    const { gameIds } = await seedRequest();
    const id = gameIds[0]!;
    for (const res of [
      await post(`/bookings/${id}/confirm`, a.token),
      await post(`/bookings/${id}/reject`, a.token, { reason: 'no' }),
      await post(`/bookings/${id}/cancel`, a.token),
      await api().post(`/api/v1/me/bookings/${id}/cancel`).set(...bearer(player.token)).send({}),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('series_request_open');
    }
    expect((await Booking.findById(id).setOptions(cross))!.status).toBe('pending');
  });
});

describe('owner series: cancelling', () => {
  async function playerSeries() {
    const res = await post(turfBase(), a.token, groupBody({ customer: { name: 'Rahim', phone: PHONE, playerId: player.userId } }));
    await Notification.deleteMany({}).setOptions(cross);
    return res.body.series as { id: string; games: { id: string; startAt: string }[] };
  }

  it('cancel-future cancels future games only', async () => {
    const s = await playerSeries();
    await setClock('2026-01-06T13:30:00Z'); // game 1 (12:00Z-13:00Z) is over
    const res = await post(`/series/${s.id}/cancel-future`, manager.token, { reason: 'Ремонт' });
    expect(res.status).toBe(200);
    expect(res.body.series.status).toBe('cancelled');
    expect(res.body.cancelled).toEqual(s.games.slice(1).map((g) => g.id));
    expect(res.body.kept).toEqual([]);
    expect(res.body.series.games.map((g: { status: string }) => g.status)).toEqual(['confirmed', 'cancelled', 'cancelled', 'cancelled']);

    const rows = await notices();
    expect(rows.map((r) => [r.event, r.to])).toEqual([['series_games_cancelled', player.email]]);
    expect(rows[0]!.data).toMatchObject({ games: s.games.slice(1).map((g) => g.startAt), reason: 'Ремонт' });
    expect(await ActivityLog.countDocuments({ ownerId: a.ownerId, action: 'series.cancel', entityId: s.id })).toBe(1);
    const stored = (await RecurringSeries.findById(s.id).setOptions(cross))!;
    expect(stored.lastEndAt.toISOString()).toBe(at('19:00', TUE[0]!).toISOString());

    const again = await post(`/series/${s.id}/cancel-future`, manager.token);
    expect(again.status).toBe(200);
    expect(again.body.cancelled).toEqual([]);
    expect(await Notification.countDocuments({}).setOptions(cross)).toBe(1);
  });

  it('staff without booking.cancel gets 403; a waiting request gets 409 series_request_open', async () => {
    const s = await playerSeries();
    expect((await post(`/series/${s.id}/cancel-future`, staff.token)).status).toBe(403);
    const { seriesId } = await seedRequest(v2, t2);
    const res = await post(`/series/${seriesId}/cancel-future`, a.token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('series_request_open');
  });

  it('cancel one game sends the summary, not booking_cancelled', async () => {
    const s = await playerSeries();
    const res = await post(`/bookings/${s.games[1]!.id}/cancel`, a.token);
    expect(res.status).toBe(200);
    const rows = await notices();
    expect(rows.map((r) => [r.event, r.to])).toEqual([['series_games_cancelled', player.email]]);
    expect(rows[0]!.data).toMatchObject({ games: [s.games[1]!.startAt] });
    expect((await RecurringSeries.findById(s.id).setOptions(cross))!.status).toBe('active');
  });
});
