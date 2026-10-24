import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { Booking, bookingJson, holdingFilter } from '../../src/bookings/booking.model';
import { Refund } from '../../src/payments/refund.model';
import { SlotLock } from '../../src/bookings/slotLock.model';
import { newReference } from '../../src/bookings/reference';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([Booking.init(), SlotLock.init(), Refund.init()]);
});
afterAll(stopTestDb);
beforeEach(async () => {
  await Promise.all([
    Booking.deleteMany({ ownerId: { $exists: true } }),
    SlotLock.deleteMany({ ownerId: { $exists: true } }),
    Refund.deleteMany({ ownerId: { $exists: true } }),
  ]);
});

function refundFields(overrides: Record<string, unknown>) {
  return {
    ownerId: oid(),
    venueId: oid(),
    bookingId: oid(),
    paymentId: oid(),
    amount: 500,
    currency: 'INR',
    reason: 'cancellation',
    status: 'pending',
    ...overrides,
  };
}

describe('Refund', () => {
  it('a cash refund needs no gateway', async () => {
    await expect(
      Refund.create(refundFields({ method: 'cash', gateway: null, gatewayAccountId: null })),
    ).resolves.toBeTruthy();
  });

  it('a card refund needs its gateway and account', async () => {
    await expect(
      Refund.create(refundFields({ method: 'card', gateway: null, gatewayAccountId: null })),
    ).rejects.toMatchObject({ name: 'ValidationError', errors: { gateway: expect.anything() } });
  });

  it('refund reason must be known', async () => {
    await expect(
      Refund.create(refundFields({ method: 'cash', gateway: null, gatewayAccountId: null, reason: 'manual' })),
    ).rejects.toMatchObject({ name: 'ValidationError', errors: { reason: expect.anything() } });
  });
});

const oid = () => new mongoose.Types.ObjectId();
const startAt = new Date('2026-01-02T10:00:00Z');

describe('SlotLock', () => {
  it('rejects a second lock on the same turf and start', async () => {
    const ownerId = oid();
    const turfId = oid();
    await SlotLock.create({ ownerId, turfId, startAt, bookingId: oid() });
    await expect(SlotLock.create({ ownerId, turfId, startAt, bookingId: oid() })).rejects.toMatchObject({ code: 11000 });
  });

  it('allows the same start on another turf', async () => {
    const ownerId = oid();
    await SlotLock.create({ ownerId, turfId: oid(), startAt, bookingId: oid() });
    await expect(SlotLock.create({ ownerId, turfId: oid(), startAt, bookingId: oid() })).resolves.toBeTruthy();
  });
});

function makeBooking(ownerId: mongoose.Types.ObjectId, status: string, holdExpiresAt: Date | null = null) {
  return Booking.create({
    ownerId,
    venueId: oid(),
    turfId: oid(),
    reference: newReference(),
    businessDate: '2026-01-02',
    startAt,
    endAt: new Date(startAt.getTime() + 3600_000),
    slots: [{ startAt, endAt: new Date(startAt.getTime() + 3600_000), price: 1000 }],
    addons: [],
    currency: 'INR',
    subtotal: 1000,
    addonsTotal: 0,
    total: 1000,
    advanceRequired: 0,
    status,
    paymentStatus: 'unpaid',
    holdExpiresAt,
    source: 'online',
    policySnapshot: { paymentPolicy: null, refundRules: [] },
  });
}

describe('holdingFilter', () => {
  it('matches holding bookings and live holds only', async () => {
    const ownerId = oid();
    const now = new Date('2026-01-02T09:00:00Z');
    const min = 60_000;
    const confirmed = await makeBooking(ownerId, 'confirmed');
    const completed = await makeBooking(ownerId, 'completed');
    const live = await makeBooking(ownerId, 'awaiting_payment', new Date(now.getTime() + min));
    const stale = await makeBooking(ownerId, 'awaiting_payment', new Date(now.getTime() - min));
    const cancelled = await makeBooking(ownerId, 'cancelled');
    const ids = (await Booking.find({ ownerId, ...holdingFilter(now) })).map((b) => String(b._id));
    expect(ids.sort()).toEqual([confirmed, completed, live].map((b) => String(b._id)).sort());
    expect(ids).not.toContain(String(stale._id));
    expect(ids).not.toContain(String(cancelled._id));
  });
});

describe('newReference', () => {
  it('is 8 Crockford base32 characters and distinct', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const r = newReference();
      expect(r).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
      seen.add(r);
    }
    expect(seen.size).toBe(1000);
  });
});

describe('bookingJson', () => {
  it('omits ownerId and policySnapshot', async () => {
    const b = await makeBooking(oid(), 'confirmed');
    const json = bookingJson(b);
    expect(json).not.toHaveProperty('ownerId');
    expect(json).not.toHaveProperty('policySnapshot');
    expect(json).toMatchObject({ id: String(b._id), reference: b.reference, slots: [{ price: 1000 }] });
    expect(typeof json.slots[0]!.startAt).toBe('string');
  });

  it('a booking starts with nothing refunded', async () => {
    const b = await makeBooking(oid(), 'confirmed');
    expect(b.amountRefunded).toBe(0);
    expect(b.cancelledBy).toBeNull();
  });

  it('bookingJson exposes the refund and cancellation fields', async () => {
    const b = await makeBooking(oid(), 'confirmed');
    const json = bookingJson(b);
    expect(json).toMatchObject({ amountRefunded: 0, cancelledAt: null, cancelledBy: null, cancelReason: null });
  });
});
