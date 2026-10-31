import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { AddonQuoteError, BookingQuoteError, InvalidMoneyError, hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { makeTestServices, type TestServices } from '../helpers/testServices';
import { buildTestApp, testConfig } from '../helpers/testApp';
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
import { Addon } from '../../src/addons/addon.model';
import { AddonAssignment } from '../../src/addons/assignment.model';
import { Booking } from '../../src/bookings/booking.model';
import { SlotLock } from '../../src/bookings/slotLock.model';
import { Payment } from '../../src/bookings/payment.model';
import { createBooking, quoteFor } from '../../src/bookings/create';
import { PlatformSettings, clearSettingsCache } from '../../src/admin/settings';
import { loadDay } from '../../src/schedule/load';
import { AppError } from '../../src/errors';

// References handed out by newReference, front first; empty = the real generator.
const refs = vi.hoisted(() => ({ queue: [] as string[] }));
vi.mock('../../src/bookings/reference', async (orig) => {
  const actual = await orig<typeof import('../../src/bookings/reference')>();
  return { newReference: () => refs.queue.shift() ?? actual.newReference() };
});

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init(), Turf.init(), Closure.init(),
    SlotOverride.init(), Addon.init(), AddonAssignment.init(), Booking.init(), SlotLock.init(), Payment.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const TZ = 'Asia/Dhaka';
const D = '2026-01-10'; // a Saturday
const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '23:00' }]),
);
const pricing = { base: 1500, rules: [] };

let services: TestServices;
let ownerId: string;
let userId: string;
let venue: VenueDoc;
let turf: TurfDoc;

beforeEach(async () => {
  refs.queue.length = 0;
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[Venue, Turf, Closure, SlotOverride, Addon, AddonAssignment, Booking, SlotLock, Payment].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions({ crossTenant: true }),
    ),
    PlatformSettings.deleteMany({}),
  ]);
  clearSettingsCache();
  services = makeTestServices();
  ({ ownerId, userId } = await seedOwner(services));
  venue = await makeVenue();
  turf = await seedTurf(ownerId, venue.id as string, { pricing });
});

async function makeVenue(settings: Record<string, unknown> = {}, timezone = TZ): Promise<VenueDoc> {
  return seedVenue(ownerId, { timezone, settings: { hours: HOURS, bookingWindowDays: 365, ...settings } });
}

const at = (hm: string, date = D, tz = TZ) => localToUtc(date, hmToMin(hm), tz);
const player = () => ({ playerId: userId, guest: null, createdBy: userId });
const guest = { name: 'Иван Петров', phone: '+8801711111111' };

type Input = Parameters<typeof createBooking>[0];
function book(over: Partial<Input> & { hms?: string[] } = {}) {
  const { hms = ['18:00'], ...rest } = over;
  return createBooking({
    venue,
    turf,
    date: D,
    startAts: hms.map((hm) => at(hm)),
    selection: [],
    source: 'online',
    now: services.now(),
    config: testConfig,
    who: player(),
    ...rest,
  });
}

async function grid(t = turf, date = D, v = venue) {
  const { day } = await loadDay(ownerId, v, t, date, services.now());
  return day.slots;
}
const statusAt = async (hm: string, t = turf) =>
  (await grid(t)).find((s) => s.startAt.getTime() === at(hm).getTime())?.status;

const appError = (code: string, status: number) =>
  expect.objectContaining({ name: 'AppError', status, code }) as unknown;

describe('grid after the hours move under a booking', () => {
  it('shows every slot the booking overlaps as taken, and refuses them', async () => {
    await book({ hms: ['18:00'] });
    await Venue.updateOne({ _id: venue._id }, { 'settings.hours': Object.fromEntries(
      Object.keys(HOURS).map((d) => [d, { open: '08:30', close: '23:30' }]),
    ) }).setOptions({ crossTenant: true });
    const v = (await Venue.findById(venue._id).setOptions({ crossTenant: true }))!;
    const slots = (await loadDay(ownerId, v, turf, D, services.now())).day.slots;
    const st = (hm: string) => slots.find((s) => s.localStart === hm)?.status;
    expect([st('16:30'), st('17:30'), st('18:30'), st('19:30')]).toEqual(['available', 'booked', 'booked', 'available']);
    await expect(book({ venue: v, hms: ['18:30'] })).rejects.toMatchObject({ code: 'slot_taken' });
  });
});

describe('createBooking', () => {
  it('registered player at a no-advance venue is confirmed', async () => {
    const b = await book({ hms: ['18:00', '19:00'] });
    expect(b.status).toBe('confirmed');
    expect(b.paymentStatus).toBe('unpaid');
    expect(b.slots.map((s) => s.price)).toEqual([1500, 1500]);
    expect(b.total).toBe(3000);
    expect(b.subtotal).toBe(3000);
    expect(b.businessDate).toBe(D);
    expect(b.startAt).toEqual(at('18:00'));
    expect(b.endAt).toEqual(at('20:00'));
    expect(b.holdExpiresAt).toBeNull();
    expect(b.currency).toBe('BDT');
    expect(String(b.playerId)).toBe(userId);
    expect(b.reference).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(await SlotLock.countDocuments({ ownerId, bookingId: b._id })).toBe(2);
    expect((b.policySnapshot.paymentPolicy as { type: string }).type).toBe('none');
    expect(await statusAt('18:00')).toBe('booked');
  });

  it('advance venue makes a 10-minute hold', async () => {
    venue = await makeVenue({ paymentPolicy: { type: 'partial_percent', percent: 20 } });
    turf = await seedTurf(ownerId, venue.id as string, { pricing });
    const first = await book({ hms: ['18:00', '19:00'] });
    expect(first.status).toBe('awaiting_payment');
    expect(first.advanceRequired).toBe(600);
    expect(first.holdExpiresAt).toEqual(new Date(services.now().getTime() + 10 * 60_000));
    expect(await statusAt('18:00')).toBe('pending');

    services.clock.advance(11 * 60_000);
    expect(await statusAt('18:00')).toBe('available');

    const second = await book({ hms: ['18:00'], now: services.now() });
    expect(second.status).toBe('awaiting_payment');
    const stale = await Booking.findOne({ ownerId, _id: first._id });
    expect(stale!.status).toBe('expired');
    expect(await SlotLock.countDocuments({ ownerId, bookingId: first._id })).toBe(0);
    expect(await SlotLock.countDocuments({ ownerId, bookingId: second._id })).toBe(1);
  });

  it('guest starts pending', async () => {
    const b = await book({ who: { playerId: null, guest, createdBy: null } });
    expect(b.status).toBe('pending');
    expect(b.guest).toMatchObject(guest);
    expect(b.playerId).toBeNull();
    expect(b.createdBy).toBeNull();
    expect(await statusAt('18:00')).toBe('pending');
  });

  it('retries the reference on a duplicate', async () => {
    const first = await book({ hms: ['10:00'] });
    refs.queue.push(first.reference, first.reference, 'ZZZZZZZZ');
    const b = await book({ hms: ['11:00'] });
    expect(b.reference).toBe('ZZZZZZZZ');
    expect(await Booking.countDocuments({ ownerId })).toBe(2);
  });

  it('concurrent same slot → one booking, the other 409 slot_taken', async () => {
    for (const [a, b, locks] of [
      [['18:00'], ['18:00'], 1],
      [['18:00', '19:00'], ['19:00', '20:00'], 2],
    ] as const) {
      await Promise.all([Booking.deleteMany({ ownerId }), SlotLock.deleteMany({ ownerId })]);
      const results = await Promise.allSettled([book({ hms: [...a] }), book({ hms: [...b] })]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(AppError);
      expect(rejected[0]!.reason).toEqual(appError('slot_taken', 409));
      expect(await Booking.countDocuments({ ownerId })).toBe(1);
      expect(await SlotLock.countDocuments({ ownerId })).toBe(locks);
    }
  }, 60_000);

  it('overlap with an off-grid booking → 409 slot_taken', async () => {
    const start = at('18:30');
    const end = at('19:30');
    const other = await Booking.create({
      ownerId, venueId: venue._id, turfId: turf._id, reference: 'OFFGRID1', businessDate: D,
      startAt: start, endAt: end, slots: [{ startAt: start, endAt: end, price: 1500 }], currency: 'BDT',
      subtotal: 1500, addonsTotal: 0, total: 1500, advanceRequired: 0, status: 'confirmed', paymentStatus: 'unpaid',
      source: 'online', policySnapshot: { paymentPolicy: { type: 'none' }, refundRules: [] },
    });
    await SlotLock.create({ ownerId, turfId: turf._id, startAt: start, bookingId: other._id });
    await expect(book({ hms: ['18:00'] })).rejects.toEqual(appError('slot_taken', 409));
    await expect(book({ hms: ['19:00'] })).rejects.toEqual(appError('slot_taken', 409));
    expect(await Booking.countDocuments({ ownerId })).toBe(1);
    await expect(book({ hms: ['17:00'] })).resolves.toBeTruthy();
  });

  it('stock across turfs', async () => {
    const racket = await Addon.create({
      ownerId, name: 'Racket', pricingType: 'per_unit', price: 100, currency: 'BDT', stock: 1,
    });
    await AddonAssignment.create({ ownerId, addonId: racket._id, venueId: venue._id, turfId: null, enabled: true });
    const t1 = turf;
    const t2 = await seedTurf(ownerId, venue.id as string, { pricing });
    const selection = [{ addonId: racket.id as string, quantity: 1 }];

    const ok = await book({ turf: t1, selection });
    expect(ok.addons).toEqual([expect.objectContaining({ addonId: racket.id, quantity: 1, total: 100 })]);
    expect(ok.total).toBe(1600);

    const out = book({ turf: t2, selection });
    await expect(out).rejects.toBeInstanceOf(AddonQuoteError);
    await expect(out).rejects.toMatchObject({ code: 'addon_out_of_stock' });
    await expect(book({ turf: t2, selection, hms: ['20:00'] })).resolves.toBeTruthy();

    const results = await Promise.allSettled([
      book({ turf: t1, selection, hms: ['21:00'] }),
      book({ turf: t2, selection, hms: ['21:00'] }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected[0]!.reason).toBeInstanceOf(AddonQuoteError);
    expect(rejected[0]!.reason).toMatchObject({ code: 'addon_out_of_stock' });
    expect(await Booking.countDocuments({ ownerId, startAt: at('21:00') })).toBe(1);
  }, 60_000);

  it('walk-in', async () => {
    venue = await makeVenue({ paymentPolicy: { type: 'full' } });
    turf = await seedTurf(ownerId, venue.id as string, { pricing });
    const walkin = (over: Partial<Input> & { hms?: string[] } = {}) =>
      book({ source: 'walkin', who: { playerId: null, guest, createdBy: userId }, hms: ['18:00', '19:00'], ...over });

    const plain = await walkin();
    expect(plain.status).toBe('confirmed');
    expect(plain.advanceRequired).toBe(0);
    expect(plain.paymentStatus).toBe('unpaid');
    expect((plain.policySnapshot.paymentPolicy as { type: string }).type).toBe('full');

    const paid = await walkin({ hms: ['10:00', '11:00'], cash: { amount: 3000, recordedBy: userId } });
    const payments = await Payment.find({ ownerId, bookingId: paid._id });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ method: 'cash', status: 'succeeded', amount: 3000, currency: 'BDT' });
    expect(String(payments[0]!.recordedBy)).toBe(userId);
    expect(paid.amountPaid).toBe(3000);
    expect(paid.paymentStatus).toBe('paid');
    expect(await Booking.findOne({ ownerId, _id: paid._id })).toMatchObject({ amountPaid: 3000, paymentStatus: 'paid' });

    const part = await walkin({ hms: ['12:00', '13:00'], cash: { amount: 1000, recordedBy: userId } });
    expect(part.paymentStatus).toBe('partially_paid');
    expect(part.amountPaid).toBe(1000);

    const before = [await Booking.countDocuments({ ownerId }), await SlotLock.countDocuments({ ownerId }), await Payment.countDocuments({ ownerId })];
    for (const amount of [0, 3001, 10.5]) {
      await expect(walkin({ hms: ['14:00', '15:00'], cash: { amount, recordedBy: userId } })).rejects.toBeInstanceOf(
        InvalidMoneyError,
      );
    }
    expect([await Booking.countDocuments({ ownerId }), await SlotLock.countDocuments({ ownerId }), await Payment.countDocuments({ ownerId })]).toEqual(before);

    // 20 minutes into the 16:00 slot.
    services.clock.advance(at('16:20').getTime() - services.now().getTime());
    const online = book({ hms: ['16:00'], now: services.now() });
    await expect(online).rejects.toBeInstanceOf(BookingQuoteError);
    await expect(online).rejects.toMatchObject({ code: 'slot_unavailable' });
    const inProgress = await walkin({ hms: ['16:00'], now: services.now() });
    expect(inProgress.status).toBe('confirmed');
  });

  it('midnight: a night session stays on its business day', async () => {
    // Sunday opens at 00:00, so only the Saturday night session keeps 00:00 off its grid.
    const hours = { sat: { open: '18:00', close: '02:00' }, sun: { open: '00:00', close: '23:00' } };
    turf = await seedTurf(ownerId, venue.id as string, { pricing, settings: { hours } });
    const b = await book({ startAts: [at('23:00'), at('24:00')] });
    expect(b.businessDate).toBe(D);
    expect(b.endAt).toEqual(at('25:00'));
    expect(await SlotLock.countDocuments({ ownerId, bookingId: b._id })).toBe(2);
    const next = await grid(turf, '2026-01-11');
    expect(next[0]!.localStart).toBe('02:00');
    expect(next.some((s) => s.localStart === '00:00' || s.localStart === '01:00')).toBe(false);
  });

  it('DST fall-back: two slots across 01:00 get distinct locks and real minutes', async () => {
    const LON = 'Europe/London';
    const DAY = '2026-10-25'; // a Sunday
    services.clock.advance(Date.parse('2026-10-20T00:00:00Z') - services.now().getTime());
    venue = await makeVenue({}, LON);
    turf = await seedTurf(ownerId, venue.id as string, { pricing, settings: { hours: { sun: { open: '00:00', close: '04:00' } } } });
    const lamp = await Addon.create({ ownerId, name: 'Lights', pricingType: 'per_hour', price: 600, currency: 'BDT' });
    await AddonAssignment.create({ ownerId, addonId: lamp._id, venueId: venue._id, turfId: null, enabled: true });

    const slots = await grid(turf, DAY);
    const ones = slots.filter((s) => s.localStart === '01:00');
    expect(ones).toHaveLength(2);
    const b = await book({
      date: DAY,
      startAts: ones.map((s) => s.startAt),
      selection: [{ addonId: lamp.id as string }],
      now: services.now(),
    });
    const locks = await SlotLock.find({ ownerId, bookingId: b._id }).sort({ startAt: 1 });
    expect(locks.map((l) => l.startAt.toISOString())).toEqual(['2026-10-25T00:00:00.000Z', '2026-10-25T01:00:00.000Z']);
    const minutes = b.slots.reduce((sum, s) => sum + (s.endAt.getTime() - s.startAt.getTime()) / 60_000, 0);
    expect(minutes).toBe(120);
    expect(b.addons).toEqual([expect.objectContaining({ addonId: lamp.id, minutes, total: 1200 })]);
  });

  it('outside window or closed', async () => {
    await expect(book({ date: '2027-01-02', startAts: [at('18:00', '2027-01-02')] })).rejects.toEqual(
      appError('outside_window', 400),
    );
    await Closure.create({ ownerId, venueId: venue._id, turfId: null, from: D, to: D, reason: 'Eid' });
    const closed = book();
    await expect(closed).rejects.toBeInstanceOf(BookingQuoteError);
    await expect(closed).rejects.toMatchObject({ code: 'day_closed' });
    expect(await Booking.countDocuments({ ownerId })).toBe(0);
  });
});

async function setFee(fee: Record<string, unknown>) {
  await PlatformSettings.updateOne(
    { _id: 'platform' },
    { $set: { general: { ownerApproval: 'manual', fee, payout: { bkash: null, nagad: null, stripe: null } } } },
    { upsert: true },
  );
  clearSettingsCache();
}
const fixed50 = { mode: 'fixed', fixed: 50, percent: null, payer: 'player' };
const percentFee = (percent: number) => ({ mode: 'percent', fixed: null, percent, payer: 'player' });

describe('platform fee snapshot', () => {
  // BDT 1000 a slot.
  beforeEach(async () => {
    venue = await seedVenue(ownerId, {
      published: true,
      slug: `fee-${Math.random().toString(36).slice(2, 8)}`,
      timezone: TZ,
      settings: { hours: HOURS, bookingWindowDays: 365 },
    });
    turf = await seedTurf(ownerId, venue.id as string, { pricing: { base: 100000, rules: [] } });
  });

  it('online booking snapshots the fee', async () => {
    await setFee(fixed50);
    const snapshot = { mode: 'fixed', value: 50, payer: 'player', amount: 5000 };
    const { app } = buildTestApp({ services });
    const res = await request(app)
      .post(`/api/v1/venues/${venue.slug}/turfs/${turf.id as string}/quote`)
      .send({ date: D, startAts: [at('18:00').toISOString()] });
    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({ total: 105000, platformFee: snapshot });

    const b = await book();
    expect(b.total).toBe(105000);
    expect(b.subtotal).toBe(100000);
    expect(b.platformFee).toEqual(snapshot);
  });

  it('walk-in has no fee', async () => {
    await setFee(fixed50);
    const b = await book({ source: 'walkin', who: { playerId: null, guest, createdBy: userId } });
    expect(b.platformFee).toBeNull();
    expect(b.total).toBe(100000);
  });

  it('uses the fee in force at create time', async () => {
    await setFee(percentFee(5));
    const { quote } = await quoteFor({ venue, turf, date: D, startAts: [at('18:00')], selection: [], source: 'online', now: services.now(), config: testConfig });
    expect(quote.platformFee).toMatchObject({ mode: 'percent', value: 5, amount: 5000 });
    await setFee(percentFee(10));
    const b = await book();
    expect(b.platformFee).toMatchObject({ mode: 'percent', value: 10, amount: 10000 });
    expect(b.total).toBe(110000);
  });

  it('existing bookings keep their fee', async () => {
    await setFee(fixed50);
    const b = await book();
    await setFee(percentFee(10));
    const again = await Booking.findOne({ ownerId, _id: b._id });
    expect(again!.platformFee).toEqual({ mode: 'fixed', value: 50, payer: 'player', amount: 5000 });
    expect(again!.total).toBe(105000);
  });

  it('a player-paid fee joins the advance', async () => {
    await Venue.updateOne({ _id: venue._id }, { 'settings.paymentPolicy': { type: 'partial_percent', percent: 20 } }).setOptions({ crossTenant: true });
    venue = (await Venue.findById(venue._id).setOptions({ crossTenant: true }))!;
    await setFee(fixed50);
    const b = await book();
    expect(b.total).toBe(105000);
    // 20% of 100000, plus the 5000 fee.
    expect(b.advanceRequired).toBe(25000);
    expect(b.status).toBe('awaiting_payment');
  });

  it('a booking made with no settings has no fee', async () => {
    const b = await book();
    expect(b.platformFee).toBeNull();
    expect(b.total).toBe(100000);
  });
});
