import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { Booking, bookingJson } from '../../src/bookings/booking.model';
import { RecurringSeries, seriesJson } from '../../src/series/series.model';
import { newReference } from '../../src/bookings/reference';

const oid = () => new mongoose.Types.ObjectId();
const ownerId = oid();
const venueId = oid();
const turfId = oid();

beforeAll(async () => {
  await startTestDb();
  await Promise.all([Booking.init(), RecurringSeries.init()]);
});
afterAll(stopTestDb);
beforeEach(async () => {
  await Promise.all([Booking.deleteMany({ ownerId }), RecurringSeries.deleteMany({ ownerId })]);
});

function bookingFields(day: number, extra: Record<string, unknown> = {}) {
  const startAt = new Date(Date.UTC(2026, 10, day, 10));
  return {
    ownerId,
    venueId,
    turfId,
    reference: newReference(),
    businessDate: `2026-11-${String(day).padStart(2, '0')}`,
    startAt,
    endAt: new Date(startAt.getTime() + 3_600_000),
    slots: [{ startAt, endAt: new Date(startAt.getTime() + 3_600_000), price: 500 }],
    currency: 'INR',
    subtotal: 500,
    addonsTotal: 0,
    total: 500,
    advanceRequired: 0,
    status: 'confirmed',
    paymentStatus: 'unpaid',
    source: 'walkin',
    guest: { name: 'G', phone: '+911111111111' },
    policySnapshot: { paymentPolicy: null, refundRules: [] },
    ...extra,
  };
}

describe('RecurringSeries', () => {
  it('stores a series and serialises it', async () => {
    const playerId = oid();
    const s = await RecurringSeries.create({
      ownerId,
      venueId,
      turfId,
      source: 'online',
      playerId,
      weekdays: ['tue', 'thu'],
      startTime: '10:00',
      slotCount: 1,
      firstDate: '2026-11-03',
      endDate: null,
      count: 4,
      status: 'requested',
      currency: 'INR',
      skipped: [{ date: '2026-11-05', reason: 'taken' }],
      firstStartAt: new Date('2026-11-03T10:00:00Z'),
      lastEndAt: new Date('2026-11-12T11:00:00Z'),
      respondBy: new Date('2026-11-01T10:00:00Z'),
    });
    const b2 = await Booking.create(bookingFields(10, { seriesId: s._id }));
    const b1 = await Booking.create(bookingFields(3, { seriesId: s._id }));
    const json = seriesJson(s, [b2, b1], 'Pat');
    expect(json).toMatchObject({
      id: String(s._id),
      venueId: String(venueId),
      turfId: String(turfId),
      status: 'requested',
      source: 'online',
      pattern: { weekdays: ['tue', 'thu'], startTime: '10:00', slotCount: 1, firstDate: '2026-11-03', endDate: null, count: 4 },
      currency: 'INR',
      player: { id: String(playerId), name: 'Pat' },
      guest: null,
      skipped: [{ date: '2026-11-05', reason: 'taken' }],
      respondBy: '2026-11-01T10:00:00.000Z',
      declineReason: null,
    });
    expect(json.games.map((g) => g.businessDate)).toEqual(['2026-11-03', '2026-11-10']);
    expect(json.games[0]).toEqual({
      id: String(b1._id),
      reference: b1.reference,
      businessDate: '2026-11-03',
      startAt: '2026-11-03T10:00:00.000Z',
      endAt: '2026-11-03T11:00:00.000Z',
      status: 'confirmed',
      total: 500,
      amountPaid: 0,
    });
  });

  it('includes the guest of a walk-in series', async () => {
    const s = await RecurringSeries.create({
      ownerId, venueId, turfId, source: 'walkin', guest: { name: 'G', phone: '+911' },
      weekdays: ['mon'], startTime: '10:00', slotCount: 1, firstDate: '2026-11-02', endDate: '2026-12-01', count: null,
      status: 'active', currency: 'INR', firstStartAt: new Date(), lastEndAt: new Date(),
    });
    expect(seriesJson(s, [], null)).toMatchObject({ player: null, guest: { name: 'G', phone: '+911' }, games: [] });
  });

  it('tenant scoping applies', async () => {
    await expect(RecurringSeries.find({})).rejects.toThrow();
  });
});

describe('Booking.seriesId', () => {
  it('bookingJson carries seriesId', async () => {
    const plain = await Booking.create(bookingFields(3));
    expect(bookingJson(plain).seriesId).toBeNull();
    const sid = oid();
    const linked = await Booking.create(bookingFields(4, { seriesId: sid }));
    expect(bookingJson(linked).seriesId).toBe(String(sid));
  });
});
