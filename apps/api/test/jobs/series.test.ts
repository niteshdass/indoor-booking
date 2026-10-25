import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { bearer, seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { signAccessToken } from '../../src/auth/jwt';
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
import { Notification } from '../../src/notifications/notification.model';
import { RecurringSeries } from '../../src/series/series.model';
import { bookSeries } from '../../src/series/engine';
import { SWEEP_BATCH, autoDeclineSeries, autoRejectPending, endSeries, sweepConfig } from '../../src/jobs/sweeps';
import { JOBS } from '../../src/jobs/runner';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Booking.init(), SlotLock.init(), Payment.init(), Refund.init(), Notification.init(), RecurringSeries.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const TZ = 'Asia/Dhaka';
const cross = { crossTenant: true };
const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '23:00' }]),
);
const TUE = ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27'];

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let playerId: string;
let venueId: string;
let turfId: string;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Booking, SlotLock, Payment, Refund, Notification, RecurringSeries].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  ctx = buildTestApp();
  ctx.services.clock.advance(4 * 86_400_000); // 2026-01-05T00:00Z
  owner = await seedOwner(ctx.services);
  const venue = await seedVenue(owner.ownerId, {
    timezone: TZ, published: true, slug: 'v-one', settings: { hours: HOURS, bookingWindowDays: 60 },
  });
  venueId = venue.id as string;
  turfId = (await seedTurf(owner.ownerId, venueId, { pricing: { base: 1000, rules: [] } })).id as string;
  playerId = (await User.create({ name: 'Rahim', email: `p${Math.random()}@test.local`, emailVerified: true })).id as string;
});

afterEach(() => {
  sweepConfig.batch = SWEEP_BATCH;
});

const now = () => ctx.services.now();
const advanceTo = (t: Date | string) => ctx.services.clock.advance(new Date(t).getTime() - now().getTime());
const notices = (event: string) => Notification.find({ event }).setOptions(cross).sort({ _id: 1 }).lean();
const seriesOf = async (id: string) => (await RecurringSeries.findById(id).setOptions(cross))!;
const gamesOf = (seriesId: string) => Booking.find({ seriesId }).setOptions(cross).sort({ startAt: 1 });

/** A player's request (games pending) or, with mode 'owner', an active series (games confirmed). */
async function seedSeries(mode: 'request' | 'owner' = 'request', firstDate = TUE[0]!, count = 4) {
  const venue = (await Venue.findById(venueId).setOptions(cross))!;
  const turf = (await Turf.findById(turfId).setOptions(cross))!;
  const out = await bookSeries({
    venue, turf, mode, now: now(),
    who: { playerId, guest: null, createdBy: playerId },
    pattern: { weekdays: ['tue'], startTime: '18:00', slotCount: 1, firstDate, endDate: null, count },
  });
  await Notification.deleteMany({ event: { $ne: 'series_declined' } }).setOptions(cross);
  return { seriesId: out.series.id as string, gameIds: out.games.map((g) => g.id as string) };
}

describe('autoDeclineSeries', () => {
  it('auto-declines at respondBy, not before', async () => {
    const { seriesId, gameIds } = await seedSeries();
    const respondBy = (await seriesOf(seriesId)).respondBy!;
    expect(await autoDeclineSeries(new Date(respondBy.getTime() - 1))).toBe(0);
    expect((await seriesOf(seriesId)).status).toBe('requested');

    expect(await autoDeclineSeries(respondBy)).toBe(1);
    const s = await seriesOf(seriesId);
    expect(s.status).toBe('declined');
    expect(s.declineReason).toBeNull();
    expect(s.decidedAt).toEqual(respondBy);
    expect(s.decidedBy).toBeNull();
    const games = await gamesOf(seriesId);
    expect(games.map((g) => g.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected']);
    expect(games.every((g) => g.rejectReason === 'Not confirmed in time')).toBe(true);
    expect(await SlotLock.countDocuments({ ownerId: owner.ownerId, bookingId: { $in: gameIds } })).toBe(0);
    const rows = await notices('series_declined');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toMatchObject({ autoRejected: true });
    const logs = await ActivityLog.find({ entityId: seriesId }).setOptions(cross);
    expect(logs.map((l) => [l.action, l.actorId])).toEqual([['series.decline', null]]);
    expect(await ActivityLog.countDocuments({ entityId: { $in: gameIds } }).setOptions(cross)).toBe(0);

    expect(await autoDeclineSeries(respondBy)).toBe(0);
    expect(await notices('series_declined')).toHaveLength(1);
  });

  it('accept vs auto-decline race leaves one outcome', async () => {
    const { seriesId } = await seedSeries();
    const respondBy = (await seriesOf(seriesId)).respondBy!;
    advanceTo(new Date(respondBy.getTime() - 1));
    const token = await signAccessToken(owner.userId, ctx.config.jwtSecret, now());
    const accept = request(ctx.app)
      .post(`/api/v1/owners/${owner.ownerId}/series/${seriesId}/accept`)
      .set(...bearer(token))
      .send({})
      .then((r) => r);
    const [res, swept] = await Promise.all([accept, autoDeclineSeries(respondBy)]);

    const s = await seriesOf(seriesId);
    const statuses = (await gamesOf(seriesId)).map((g) => g.status);
    if (res.status === 200) {
      expect(swept).toBe(0);
      expect(s.status).toBe('active');
      expect(statuses.every((x) => x === 'confirmed')).toBe(true);
    } else {
      expect(res.status).toBe(409);
      expect(swept).toBe(1);
      expect(s.status).toBe('declined');
      expect(statuses.every((x) => x === 'rejected')).toBe(true);
    }
    expect(await ActivityLog.countDocuments({ entityId: seriesId, action: /^series\.(accept|decline)$/ }).setOptions(cross)).toBe(1);
  });

  it('a series already answered is skipped', async () => {
    const { seriesId } = await seedSeries();
    const respondBy = (await seriesOf(seriesId)).respondBy!;
    await RecurringSeries.updateOne({ _id: seriesId }, { $set: { status: 'withdrawn' } }).setOptions(cross);
    expect(await autoDeclineSeries(respondBy)).toBe(0);
    expect((await seriesOf(seriesId)).status).toBe('withdrawn');
  });

  it('batches: with batch 1, three due requests are all declined', async () => {
    sweepConfig.batch = 1;
    const ids: string[] = [];
    for (const d of ['2026-01-13', '2026-01-20', '2026-01-27']) {
      // Different turfs avoid clashes between the three requests.
      const turf = await seedTurf(owner.ownerId, venueId, { pricing: { base: 1000, rules: [] } });
      turfId = turf.id as string;
      ids.push((await seedSeries('request', d, 2)).seriesId);
    }
    const last = Math.max(...(await Promise.all(ids.map(async (i) => (await seriesOf(i)).respondBy!.getTime()))));
    expect(await autoDeclineSeries(new Date(last))).toBe(3);
    for (const id of ids) expect((await seriesOf(id)).status).toBe('declined');
  });
});

describe('autoRejectPending', () => {
  it('leaves series games alone', async () => {
    const { seriesId } = await seedSeries();
    const first = (await gamesOf(seriesId))[0]!;
    advanceTo(new Date(first.startAt.getTime() - 60 * 60_000));
    expect(await autoRejectPending(now())).toBe(0);
    expect((await gamesOf(seriesId)).map((g) => g.status)).toEqual(['pending', 'pending', 'pending', 'pending']);
  });
});

describe('endSeries', () => {
  it('ends an active series after its last game, and only that', async () => {
    const { seriesId } = await seedSeries('owner');
    const { seriesId: requested } = await seedSeries('request', '2026-02-03', 2);
    const { seriesId: cancelled } = await seedSeries('owner', '2026-02-10', 2);
    await RecurringSeries.updateOne({ _id: cancelled }, { $set: { status: 'cancelled' } }).setOptions(cross);
    const lastEnd = (await seriesOf(seriesId)).lastEndAt;
    expect(await endSeries(new Date(lastEnd.getTime() - 1))).toBe(0);
    expect((await seriesOf(seriesId)).status).toBe('active');
    const later = new Date('2026-03-01T00:00:00Z');
    expect(await endSeries(later)).toBe(1);
    expect((await seriesOf(seriesId)).status).toBe('ended');
    expect((await seriesOf(requested)).status).toBe('requested');
    expect((await seriesOf(cancelled)).status).toBe('cancelled');
  });

  it('is registered with the runner', () => {
    expect(JOBS.find((j) => j.name === 'series-auto-decline')?.everyMs).toBe(60_000);
    expect(JOBS.find((j) => j.name === 'series-end')?.everyMs).toBe(300_000);
  });
});
