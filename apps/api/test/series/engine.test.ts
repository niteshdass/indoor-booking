import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { addDays, hmToMin, localParts, localToUtc, weekdayOf, type SeriesPattern } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { testConfig } from '../helpers/testApp';
import { PlatformSettings, clearSettingsCache } from '../../src/admin/settings';
import { makeTestServices, type TestServices } from '../helpers/testServices';
import { seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { Venue, type VenueDoc } from '../../src/venues/venue.model';
import { Turf, type TurfDoc } from '../../src/venues/turf.model';
import { Closure } from '../../src/schedule/closure.model';
import { SlotOverride } from '../../src/schedule/slotOverride.model';
import { Booking, holdingFilter } from '../../src/bookings/booking.model';
import { SlotLock } from '../../src/bookings/slotLock.model';
import { Payment } from '../../src/bookings/payment.model';
import { createBooking } from '../../src/bookings/create';
import { RecurringSeries } from '../../src/series/series.model';
import { bookSeries, seriesAvailability, type SeriesWho } from '../../src/series/engine';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init(), Turf.init(), Closure.init(),
    SlotOverride.init(), Booking.init(), SlotLock.init(), Payment.init(), RecurringSeries.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const TZ = 'Asia/Dhaka';
const MON = '2026-01-05'; // "today" after the clock moves; a Monday
const TUE = ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27', '2026-02-03'];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const hoursOf = (open: string, close: string) => Object.fromEntries(DAYS.map((d) => [d, { open, close }]));
const pricing = { base: 1000, rules: [] };

let services: TestServices;
let ownerId: string;
let userId: string;
let venue: VenueDoc;
let turf: TurfDoc;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[Venue, Turf, Closure, SlotOverride, Booking, SlotLock, Payment, RecurringSeries].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions({ crossTenant: true }),
    ),
    PlatformSettings.deleteMany({}),
  ]);
  clearSettingsCache();
  services = makeTestServices();
  services.clock.advance(4 * 86_400_000); // 2026-01-05T00:00Z = Monday 06:00 in Dhaka
  ({ ownerId, userId } = await seedOwner(services));
  ({ venue, turf } = await makeVenueTurf());
});

async function makeVenueTurf(settings: Record<string, unknown> = {}, timezone = TZ) {
  const v = await seedVenue(ownerId, {
    timezone,
    settings: { hours: hoursOf('08:00', '23:00'), bookingWindowDays: 365, ...settings },
  });
  const t = await seedTurf(ownerId, v.id as string, { pricing });
  return { venue: v, turf: t };
}

const at = (hm: string, date: string, tz = TZ) => localToUtc(date, hmToMin(hm), tz);
const pattern = (over: Partial<SeriesPattern> = {}): SeriesPattern => ({
  weekdays: ['tue'],
  startTime: '18:00',
  slotCount: 1,
  firstDate: TUE[0]!,
  endDate: null,
  count: 4,
  ...over,
});
const owner = (): SeriesWho => ({ playerId: null, guest: { name: 'Команда Альфа', phone: '+8801711111111' }, createdBy: userId });
const player = (): SeriesWho => ({ playerId: userId, guest: null, createdBy: userId });

async function seedBooking(date: string, hm: string, status = 'confirmed') {
  const startAt = at(hm, date);
  const endAt = new Date(startAt.getTime() + 3_600_000);
  return Booking.create({
    ownerId, venueId: venue._id, turfId: turf._id, reference: `R${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
    businessDate: date, startAt, endAt, slots: [{ startAt, endAt, price: 1000 }], currency: 'BDT',
    subtotal: 1000, addonsTotal: 0, total: 1000, advanceRequired: 0, status, paymentStatus: 'unpaid',
    source: 'online', policySnapshot: { paymentPolicy: { type: 'none' }, refundRules: [] },
  });
}

const walkin = { config: testConfig, source: 'walkin' } as const;
const online = { config: testConfig, source: 'online' } as const;

const run = (over: Partial<Parameters<typeof bookSeries>[0]> = {}) =>
  bookSeries({ venue, turf, pattern: pattern(), who: owner(), mode: 'owner', now: services.now(), config: testConfig, ...over });

describe('seriesAvailability', () => {
  it('preview marks each date free with price or clash with reason', async () => {
    await seedBooking(TUE[1]!, '18:00');
    await SlotOverride.create({ ownerId, venueId: venue._id, turfId: turf._id, date: TUE[2], type: 'block', start: '18:00', end: '19:00' });
    await Closure.create({ ownerId, venueId: venue._id, turfId: null, from: TUE[3], to: TUE[3], reason: 'Eid' });

    const p = await seriesAvailability(venue, turf, pattern({ count: 5, slotCount: 2 }), services.now(), walkin);
    expect(p.currency).toBe('BDT');
    expect(p.dates).toEqual([
      { date: TUE[0], status: 'free', startAt: at('18:00', TUE[0]!).toISOString(), endAt: at('20:00', TUE[0]!).toISOString(), price: 2000 },
      { date: TUE[1], status: 'clash', reason: 'taken' },
      { date: TUE[2], status: 'clash', reason: 'blocked' },
      { date: TUE[3], status: 'clash', reason: 'closed' },
      { date: TUE[4], status: 'free', startAt: at('18:00', TUE[4]!).toISOString(), endAt: at('20:00', TUE[4]!).toISOString(), price: 2000 },
    ]);
    expect(p.freeCount).toBe(2);
    expect(p.total).toBe(4000);

    const late = await seriesAvailability(venue, turf, pattern({ startTime: '23:00', slotCount: 2, count: 1 }), services.now(), walkin);
    expect(late.dates).toEqual([{ date: TUE[0], status: 'clash', reason: 'outside_hours' }]);
    const runOff = await seriesAvailability(venue, turf, pattern({ startTime: '22:00', slotCount: 2, count: 1 }), services.now(), walkin);
    expect(runOff.dates).toEqual([{ date: TUE[0], status: 'clash', reason: 'outside_hours' }]);
    expect(late.freeCount).toBe(0);
    expect(late.total).toBe(0);
  });

  it("today's slot already started is past", async () => {
    services.clock.advance(4.5 * 3_600_000); // Monday 10:30 local
    const p = await seriesAvailability(venue, turf, pattern({ weekdays: ['mon'], firstDate: MON, startTime: '10:00', count: 2 }), services.now(), walkin);
    expect(p.dates.map((d) => (d.status === 'clash' ? d.reason : d.status))).toEqual(['past', 'free']);
  });

  it('ignores bookingWindowDays', async () => {
    ({ venue, turf } = await makeVenueTurf({ bookingWindowDays: 7 }));
    const date = addDays(MON, 60);
    const p = await seriesAvailability(venue, turf, pattern({ weekdays: [weekdayOf(date)], firstDate: date, count: 1 }), services.now(), walkin);
    expect(p.dates[0]).toMatchObject({ date, status: 'free', price: 1000 });
  });

  it('pattern errors map to 400', async () => {
    await expect(seriesAvailability(venue, turf, pattern({ count: null, endDate: addDays(MON, 200) }), services.now(), walkin)).rejects.toMatchObject({
      name: 'AppError', status: 400, code: 'series_too_long',
    });
    await expect(seriesAvailability(venue, turf, pattern({ firstDate: addDays(MON, -1) }), services.now(), walkin)).rejects.toMatchObject({
      name: 'AppError', status: 400, code: 'series_past_start',
    });
    await expect(run({ pattern: pattern({ firstDate: addDays(MON, -1) }) })).rejects.toMatchObject({ status: 400, code: 'series_past_start' });
  });
});

describe('bookSeries', () => {
  it('books free dates and skips clashes in one go', async () => {
    await seedBooking(TUE[1]!, '19:00');
    await Closure.create({ ownerId, venueId: venue._id, turfId: null, from: TUE[3], to: TUE[3], reason: null });
    const { series, games } = await run({ pattern: pattern({ count: 5, slotCount: 2 }) });

    expect(series.status).toBe('active');
    expect(series.source).toBe('walkin');
    expect(series.respondBy).toBeNull();
    expect(series.currency).toBe('BDT');
    expect(series.skipped.map((s) => ({ date: s.date, reason: s.reason }))).toEqual([
      { date: TUE[1], reason: 'taken' },
      { date: TUE[3], reason: 'closed' },
    ]);
    expect(games.map((g) => g.businessDate)).toEqual([TUE[0], TUE[2], TUE[4]]);
    expect(series.firstStartAt).toEqual(at('18:00', TUE[0]!));
    expect(series.lastEndAt).toEqual(at('20:00', TUE[4]!));
    for (const g of games) {
      expect(g.status).toBe('confirmed');
      expect(g.source).toBe('walkin');
      expect(g.advanceRequired).toBe(0);
      expect(g.subtotal).toBe(2000);
      expect(g.total).toBe(2000);
      expect(g.addonsTotal).toBe(0);
      expect(g.holdExpiresAt).toBeNull();
      expect(g.currency).toBe('BDT');
      expect(String(g.seriesId)).toBe(String(series._id));
      expect(g.guest).toMatchObject({ name: 'Команда Альфа' });
      expect(g.policySnapshot.paymentPolicy).toBeNull();
      expect(g.slots.map((s) => s.price)).toEqual([1000, 1000]);
    }
    expect(await SlotLock.countDocuments({ ownerId, bookingId: { $in: games.map((g) => g._id) } })).toBe(6);
    expect(await Booking.countDocuments({ ownerId, seriesId: series._id })).toBe(3);
  });

  it('request mode creates pending online games and respondBy', async () => {
    const now = services.now();
    const far = await run({ who: player(), mode: 'request', pattern: pattern({ weekdays: ['sat'], firstDate: '2026-01-10', count: 2 }) });
    expect(far.series.status).toBe('requested');
    expect(far.series.source).toBe('online');
    expect(far.games.map((g) => [g.status, g.source])).toEqual([['pending', 'online'], ['pending', 'online']]);
    expect(far.series.respondBy).toEqual(new Date(now.getTime() + 48 * 3_600_000));
    expect(far.series.createdAt).toEqual(now);

    // Monday 06:00 now; a game at 09:00 → respondBy 07:00.
    const soon = await run({ who: player(), mode: 'request', pattern: pattern({ weekdays: ['mon'], firstDate: MON, startTime: '09:00', count: 1 }) });
    expect(soon.series.respondBy).toEqual(at('07:00', MON));

    const before = await Booking.countDocuments({ ownerId });
    await expect(
      run({ who: player(), mode: 'request', now: at('07:00', MON), pattern: pattern({ weekdays: ['mon'], firstDate: MON, startTime: '08:00', count: 1 }) }),
    ).rejects.toMatchObject({ status: 409, code: 'series_too_soon' });
    expect(await Booking.countDocuments({ ownerId })).toBe(before);
    expect(await RecurringSeries.countDocuments({ ownerId })).toBe(2);
  });

  it('no free dates writes nothing', async () => {
    await Closure.create({ ownerId, venueId: venue._id, turfId: null, from: TUE[0], to: TUE[3], reason: null });
    await expect(run()).rejects.toMatchObject({ name: 'AppError', status: 409, code: 'series_no_free_dates' });
    expect(await RecurringSeries.countDocuments({ ownerId })).toBe(0);
    expect(await Booking.countDocuments({ ownerId })).toBe(0);
    expect(await SlotLock.countDocuments({ ownerId })).toBe(0);
  });

  it('a slot lock taken after the preview skips that date as taken and books the rest', async () => {
    // A lock with no visible booking: the preview and the overlap check pass, the insert hits the unique index.
    await SlotLock.create({ ownerId, turfId: turf._id, startAt: at('18:00', TUE[1]!), bookingId: turf._id });
    const { series, games } = await run();
    expect(games.map((g) => g.businessDate)).toEqual([TUE[0], TUE[2], TUE[3]]);
    expect(series.skipped.map((s) => ({ date: s.date, reason: s.reason }))).toEqual([{ date: TUE[1], reason: 'taken' }]);
    expect(await RecurringSeries.countDocuments({ ownerId })).toBe(1);
    expect(await Booking.countDocuments({ ownerId })).toBe(3);
  });

  it('a single booking racing the series loses or wins cleanly', async () => {
    const slot = at('18:00', TUE[1]!);
    // Either side may win; several rounds exercise both outcomes.
    for (let i = 0; i < 8; i++) {
      await Promise.all([
        ...[Booking, SlotLock, RecurringSeries].map((m) => (m as typeof Booking).deleteMany({ ownerId })),
      ]);
      const [series, single] = await Promise.allSettled([
        run(),
        createBooking({
          venue, turf, date: TUE[1]!, startAts: [slot], selection: [], source: 'online', now: services.now(),
          config: testConfig, who: player(),
        }),
      ]);
      expect(series.status).toBe('fulfilled');
      const holding = await Booking.find({ ownerId, turfId: turf._id, startAt: slot, ...holdingFilter(services.now()) });
      expect(holding).toHaveLength(1);
      const locks = await SlotLock.find({ ownerId }).lean();
      expect(new Set(locks.map((l) => l.startAt.toISOString())).size).toBe(locks.length);
      expect(locks.filter((l) => l.startAt.getTime() === slot.getTime())).toHaveLength(1);
      const s = (series as PromiseFulfilledResult<Awaited<ReturnType<typeof run>>>).value;
      if (single.status === 'fulfilled') {
        expect(s.games).toHaveLength(3);
        expect(s.series.skipped.map((k) => ({ date: k.date, reason: k.reason }))).toEqual([{ date: TUE[1], reason: 'taken' }]);
        expect(String(holding[0]!._id)).toBe(String(single.value._id));
      } else {
        expect(single.reason).toMatchObject({ status: 409, code: 'slot_taken' });
        expect(s.games).toHaveLength(4);
        expect(String(holding[0]!.seriesId)).toBe(String(s.series._id));
      }
    }
  }, 60_000);

  it('DST: Europe/Berlin Tuesdays 20:00 across 2026-03-29 keep local 20:00', async () => {
    const tz = 'Europe/Berlin';
    ({ venue, turf } = await makeVenueTurf({}, tz));
    services.clock.advance(70 * 86_400_000); // 2026-03-16, a Monday
    const { games } = await run({ now: services.now(), pattern: pattern({ startTime: '20:00', firstDate: '2026-03-17', count: 3 }) });
    expect(games.map((g) => g.businessDate)).toEqual(['2026-03-17', '2026-03-24', '2026-03-31']);
    for (const g of games) expect(localParts(g.startAt, tz).hm).toBe('20:00');
    expect(games.map((g) => g.startAt.getUTCHours())).toEqual([19, 19, 18]);
  });

  it('night venue 01:00 books on the business date', async () => {
    ({ venue, turf } = await makeVenueTurf({ hours: hoursOf('16:00', '02:00') }));
    const p = pattern({ weekdays: ['fri'], startTime: '01:00', firstDate: '2026-01-09', count: 3 });
    const preview = await seriesAvailability(venue, turf, p, services.now(), walkin);
    expect(preview.freeCount).toBe(3);
    const { games } = await run({ pattern: p });
    expect(games).toHaveLength(3);
    for (const g of games) {
      expect(weekdayOf(g.businessDate)).toBe('fri');
      const local = localParts(g.startAt, TZ);
      expect(local.hm).toBe('01:00');
      expect(local.date).toBe(addDays(g.businessDate, 1));
      expect(weekdayOf(local.date)).toBe('sat');
    }
  });
});

describe('platform fee', () => {
  beforeEach(async () => {
    await PlatformSettings.updateOne(
      { _id: 'platform' },
      { $set: { general: { ownerApproval: 'manual', fee: { mode: 'fixed', fixed: 50, percent: null, payer: 'player' }, payout: { bkash: null, nagad: null, stripe: null } } } },
      { upsert: true },
    );
    clearSettingsCache();
  });
  const snapshot = { mode: 'fixed', value: 50, payer: 'player', amount: 5000 };

  it('online series games carry the fee', async () => {
    await seedBooking(TUE[1]!, '18:00');
    const p = pattern({ count: 4, slotCount: 2 });
    const preview = await seriesAvailability(venue, turf, p, services.now(), online);
    expect(preview.freeCount).toBe(3);
    expect(preview.platformFee).toEqual({ payer: 'player', perGame: [5000, 5000, 5000] });
    expect(preview.total).toBe(3 * (2000 + 5000));

    const { games } = await run({ who: player(), mode: 'request', pattern: p });
    expect(games).toHaveLength(3);
    for (const g of games) {
      expect(g.subtotal).toBe(2000);
      expect(g.total).toBe(2000 + 5000);
      expect(g.advanceRequired).toBe(0);
      expect(g.platformFee).toEqual(snapshot);
    }
    expect(games.map((g) => g.total - g.subtotal)).toEqual(preview.platformFee!.perGame);
  });

  it('an owner-paid fee leaves the series total alone but is still recorded', async () => {
    await PlatformSettings.updateOne({ _id: 'platform' }, { $set: { 'general.fee.payer': 'owner' } });
    clearSettingsCache();
    const preview = await seriesAvailability(venue, turf, pattern(), services.now(), online);
    expect(preview.platformFee).toEqual({ payer: 'owner', perGame: [5000, 5000, 5000, 5000] });
    expect(preview.total).toBe(4000);
    const { games } = await run({ who: player(), mode: 'request' });
    for (const g of games) {
      expect(g.total).toBe(1000);
      expect(g.platformFee).toEqual({ ...snapshot, payer: 'owner' });
    }
  });

  it('an owner-created series has no fee', async () => {
    const preview = await seriesAvailability(venue, turf, pattern(), services.now(), walkin);
    expect(preview.platformFee).toBeNull();
    expect(preview.total).toBe(4000);
    const { games } = await run();
    for (const g of games) {
      expect(g.platformFee).toBeNull();
      expect(g.total).toBe(1000);
    }
  });
});
