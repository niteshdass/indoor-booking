import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';

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

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let staff: Awaited<ReturnType<typeof addMember>>;
let player: { userId: string; token: string };
let other: { userId: string; token: string };
let v1: string;
let t1: string;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Closure, SlotOverride, Booking, SlotLock, Payment, Refund, Notification, RecurringSeries].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  ctx = buildTestApp();
  ctx.services.clock.advance(4 * 86_400_000); // Monday 2026-01-05 06:00 Dhaka
  a = await seedOwner(ctx.services);
  const settings = { hours: HOURS, bookingWindowDays: 7 };
  v1 = (await seedVenue(a.ownerId, { timezone: TZ, published: true, slug: 'v-one', name: 'Venue One', settings })).id as string;
  t1 = (await seedTurf(a.ownerId, v1, { pricing: { base: 1000, rules: [] } })).id as string;
  staff = await addMember(ctx.services, a.ownerId, { roleKey: 'staff' });
  const u = await User.create({ name: 'Rahim', email: `p${Math.random()}@test.local`, emailVerified: true });
  const o = await User.create({ name: 'Karim', email: `q${Math.random()}@test.local`, emailVerified: true });
  player = { userId: u.id as string, token: '' };
  other = { userId: o.id as string, token: '' };
  await resign();
});

async function resign() {
  for (const m of [a, staff, player, other]) m.token = await signAccessToken(m.userId, ctx.config.jwtSecret, ctx.services.now());
}
async function setClock(iso: string) {
  ctx.services.clock.advance(Date.parse(iso) - ctx.services.now().getTime());
  await resign();
}

const api = () => request(ctx.app);
const post = (path: string, token: string | null, body: object = {}) => {
  const r = api().post(`/api/v1${path}`);
  return (token ? r.set(...bearer(token)) : r).send(body);
};
const get = (path: string, token: string) => api().get(`/api/v1${path}`).set(...bearer(token));
const base = (turfId = t1) => `/venues/v-one/turfs/${turfId}/series`;
const body = (over: Record<string, unknown> = {}) => ({
  weekdays: ['tue'], startTime: '18:00', slotCount: 1, firstDate: TUE[0]!, count: 4, ...over,
});
const notices = () => Notification.find({}).setOptions(cross).sort({ _id: 1 });

describe('player series', () => {
  it('request creates pending games and notifies staff', async () => {
    const res = await post(base(), player.token, body());
    expect(res.status).toBe(201);
    expect(res.body.series.status).toBe('requested');
    expect(res.body.series.games).toHaveLength(4);
    expect(res.body.series.games.every((g: { status: string }) => g.status === 'pending')).toBe(true);
    const n = await notices();
    expect(n.length).toBeGreaterThan(0);
    expect(n.every((x) => x.event === 'series_requested')).toBe(true);
    expect(n.some((x) => x.event === 'staff_new_pending')).toBe(false);
    const log = await ActivityLog.findOne({ action: 'series.create' }).setOptions(cross);
    expect(String(log!.actorId)).toBe(player.userId);
  });

  it('preview returns availability', async () => {
    const res = await post(`${base()}/preview`, player.token, body());
    expect(res.status).toBe(200);
    expect(res.body.preview.freeCount).toBe(4);
  });

  it('signed-out gets 401', async () => {
    expect((await post(base(), null, body())).status).toBe(401);
    expect((await post(`${base()}/preview`, null, body())).status).toBe(401);
  });

  it('a fourth open request -> 409 series_request_limit; withdrawing one allows another', async () => {
    const ids: string[] = [];
    for (const d of ['tue', 'wed', 'thu']) {
      const date = { tue: TUE[0], wed: '2026-01-07', thu: '2026-01-08' }[d]!;
      const r = await post(base(), player.token, body({ weekdays: [d], firstDate: date, count: 1 }));
      expect(r.status).toBe(201);
      ids.push(r.body.series.id);
    }
    const fourth = await post(base(), player.token, body({ weekdays: ['fri'], firstDate: '2026-01-09', count: 1 }));
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe('series_request_limit');
    expect((await post(`/me/series/${ids[0]}/withdraw`, player.token)).status).toBe(200);
    expect((await post(base(), player.token, body({ weekdays: ['fri'], firstDate: '2026-01-09', count: 1 }))).status).toBe(201);
  });

  it('withdraw rejects the games and frees the slots', async () => {
    const id = (await post(base(), player.token, body())).body.series.id;
    await Notification.deleteMany({}).setOptions(cross);
    const res = await post(`/me/series/${id}/withdraw`, player.token);
    expect(res.status).toBe(200);
    expect(res.body.series.status).toBe('withdrawn');
    expect(res.body.series.games.every((g: { status: string }) => g.status === 'rejected')).toBe(true);
    expect(await SlotLock.countDocuments({}).setOptions(cross)).toBe(0);
    expect(await notices()).toHaveLength(0);
    expect(await ActivityLog.countDocuments({ action: 'series.withdraw' }).setOptions(cross)).toBe(1);
    expect(await ActivityLog.countDocuments({ action: /^booking\./ }).setOptions(cross)).toBe(0);
    const again = await post(`/me/series/${id}/withdraw`, player.token);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('series_not_requested');
  });

  async function activeSeries() {
    const id = (await post(base(), player.token, body())).body.series.id;
    await RecurringSeries.updateOne({ _id: id }, { $set: { status: 'active' } }).setOptions(cross);
    await Booking.updateMany({ seriesId: id }, { $set: { status: 'confirmed' } }).setOptions(cross);
    await Notification.deleteMany({}).setOptions(cross);
    return id as string;
  }

  it('player cancel-future keeps games already started', async () => {
    const id = await activeSeries();
    await setClock('2026-01-13T12:30:00Z'); // 18:30 Dhaka on the second Tuesday
    const res = await post(`/me/series/${id}/cancel-future`, player.token);
    expect(res.status).toBe(200);
    // cancelFutureGames only selects games after now, so the started game is left alone, not "kept".
    expect(res.body.cancelled).toHaveLength(2);
    const statuses = res.body.series.games.map((g: { status: string }) => g.status);
    expect(statuses).toEqual(['confirmed', 'confirmed', 'cancelled', 'cancelled']);
    const n = (await notices()).filter((x) => x.event === 'series_games_cancelled');
    expect(n.length).toBeGreaterThan(0);
    expect(n.every((x) => (x.data as { toStaff?: boolean }).toStaff === true)).toBe(true);
  });

  it('player single-game cancel on an active series sends a series summary to staff', async () => {
    const id = await activeSeries();
    const game = (await Booking.findOne({ seriesId: id }).sort({ startAt: 1 }).setOptions(cross))!;
    const res = await post(`/me/bookings/${game.id}/cancel`, player.token);
    expect(res.status).toBe(200);
    const n = await notices();
    expect(n.length).toBeGreaterThan(0);
    expect(n.every((x) => x.event === 'series_games_cancelled' && (x.data as { toStaff?: boolean }).toStaff === true)).toBe(true);
  });

  it('GET /me/series lists only mine, with venue and turf names, and never a phone', async () => {
    const mine = (await post(base(), player.token, body())).body.series.id;
    await post(base(), other.token, body({ weekdays: ['wed'], firstDate: '2026-01-07', count: 1 }));
    await RecurringSeries.updateOne({ _id: mine }, { $set: { guest: { name: 'Group', phone: '+8801700000000' } } }).setOptions(cross);
    const res = await get('/me/series', player.token);
    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(1);
    const s = res.body.series[0];
    expect(s.id).toBe(mine);
    expect(s.venue).toEqual({ slug: 'v-one', name: 'Venue One', timezone: TZ });
    expect(typeof s.turf.name).toBe('string');
    expect(s.guest).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('8801700000000');
  });

  it("another player's series is 404", async () => {
    const id = (await post(base(), player.token, body())).body.series.id;
    expect((await post(`/me/series/${id}/withdraw`, other.token)).status).toBe(404);
    expect((await post(`/me/series/${id}/cancel-future`, other.token)).status).toBe(404);
    expect((await post(`/me/series/zzz/withdraw`, other.token)).status).toBe(404);
  });
});
