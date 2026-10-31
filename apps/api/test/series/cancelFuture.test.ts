import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { makeTestServices, type TestServices } from '../helpers/testServices';
import { testConfig } from '../helpers/testApp';
import { seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Booking, type BookingDoc } from '../../src/bookings/booking.model';
import { SlotLock } from '../../src/bookings/slotLock.model';
import { Payment } from '../../src/bookings/payment.model';
import { Refund } from '../../src/payments/refund.model';
import { Notification } from '../../src/notifications/notification.model';
import { RecurringSeries, type SeriesDoc } from '../../src/series/series.model';
import { bookSeries } from '../../src/series/engine';
import { cancelFutureGames } from '../../src/series/cancelFuture';
import { AppError } from '../../src/errors';
import type { Canceller } from '../../src/bookings/cancel';
import type { AppServices } from '../../src/services';

type CancelFn = typeof import('../../src/bookings/cancel').cancelBooking;
/** Per-test override of cancelBooking; null passes through to the real one. */
let override: ((real: CancelFn, ...args: Parameters<CancelFn>) => ReturnType<CancelFn>) | null = null;

vi.mock('../../src/bookings/cancel', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/bookings/cancel')>();
  return {
    ...real,
    cancelBooking: (...args: Parameters<CancelFn>) => (override ? override(real.cancelBooking, ...args) : real.cancelBooking(...args)),
  };
});

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Booking.init(), SlotLock.init(), Payment.init(), Refund.init(), Notification.init(), RecurringSeries.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const cross = { crossTenant: true };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const HOURS = Object.fromEntries(DAYS.map((d) => [d, { open: '08:00', close: '23:00' }]));

let services: TestServices;
let ownerId: string;
let userId: string;
let series: SeriesDoc;
let games: BookingDoc[];
let by: Canceller;

beforeEach(async () => {
  override = null;
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Booking, SlotLock, Payment, Refund, Notification, RecurringSeries].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  services = makeTestServices();
  services.clock.advance(4 * 86_400_000); // Monday 2026-01-05
  ({ ownerId, userId } = await seedOwner(services));
  const venue = await seedVenue(ownerId, { timezone: 'Asia/Dhaka', settings: { hours: HOURS, bookingWindowDays: 7 } });
  const turf = await seedTurf(ownerId, venue.id as string, { pricing: { base: 1000, rules: [] } });
  ({ series, games } = await bookSeries({
    venue, turf, mode: 'owner', now: services.now(), config: testConfig,
    who: { playerId: null, guest: { name: 'Team', phone: '+8801711111111' }, createdBy: userId },
    pattern: { weekdays: ['tue'], startTime: '18:00', slotCount: 1, firstDate: '2026-01-06', endDate: null, count: 4 },
  }));
  by = { kind: 'player', ownerId, userId };
});

const deps = () => ({ config: testConfig, services: services as AppServices });
const statusOf = async (id: unknown) => (await Booking.findById(id).setOptions(cross))!.status;

describe('cancelFutureGames hardening', () => {
  it('a plain error mid-loop still records the games already cancelled, then rethrows', async () => {
    const boom = new Error('db down');
    override = (real, booking, ...rest) => {
      if (String(booking._id) === String(games[2]!._id)) return Promise.reject(boom);
      return real(booking, ...rest);
    };
    await expect(cancelFutureGames(series, by, 'rain', deps())).rejects.toBe(boom);

    expect(await statusOf(games[0]!._id)).toBe('cancelled');
    expect(await statusOf(games[1]!._id)).toBe('cancelled');
    expect(await statusOf(games[2]!._id)).toBe('confirmed');
    const rows = await Notification.find({ event: 'series_games_cancelled' }).setOptions(cross);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.data as { games: string[] }).games).toEqual([games[0]!.startAt.toISOString(), games[1]!.startAt.toISOString()]);
    expect(await ActivityLog.countDocuments({ ownerId, action: 'series.cancel' })).toBe(1);
    const stored = (await RecurringSeries.findById(series._id).setOptions(cross))!;
    expect(stored.status).toBe('active');
    expect(stored.lastEndAt.toISOString()).toBe(games[3]!.endAt.toISOString());
  });

  it('a game someone else cancelled meanwhile is dropped from kept', async () => {
    override = async (real, booking, ...rest) => {
      if (String(booking._id) === String(games[1]!._id)) {
        // Another actor cancels it first; this stale call then fails with invalid_transition.
        await real(booking, { kind: 'player', ownerId, userId }, { notify: false }, deps());
      }
      return real(booking, ...rest);
    };
    const out = await cancelFutureGames(series, by, undefined, deps());
    expect(out.kept).toEqual([]);
    expect(out.cancelled.map((b) => String(b._id))).toEqual([games[0], games[2], games[3]].map((g) => String(g!._id)));
    const rows = await Notification.find({ event: 'series_games_cancelled' }).setOptions(cross);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.data as { kept?: string[] }).kept).toBeUndefined();
    expect((await RecurringSeries.findById(series._id).setOptions(cross))!.status).toBe('cancelled');
  });

  it('a game still holding after an AppError is kept with its code', async () => {
    override = (real, booking, ...rest) =>
      String(booking._id) === String(games[3]!._id)
        ? Promise.reject(new AppError(409, 'payment_in_progress', 'busy'))
        : real(booking, ...rest);
    const out = await cancelFutureGames(series, by, undefined, deps());
    expect(out.kept.map((k) => [String(k.booking._id), k.code])).toEqual([[String(games[3]!._id), 'payment_in_progress']]);
    const rows = await Notification.find({ event: 'series_games_cancelled' }).setOptions(cross);
    expect((rows[0]!.data as { kept: string[] }).kept).toEqual([games[3]!.startAt.toISOString()]);
    expect((await RecurringSeries.findById(series._id).setOptions(cross))!.status).toBe('active');
  });
});
