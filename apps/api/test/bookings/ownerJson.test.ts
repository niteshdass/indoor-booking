import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { buildTestApp } from '../helpers/testApp';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Booking } from '../../src/bookings/booking.model';
import { ownerBookingJson, ownerBookingsJson } from '../../src/bookings/ownerJson';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init(), Turf.init(), Booking.init()]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);
afterEach(() => vi.restoreAllMocks());

const D = '2026-01-10';
let ownerId: string;
let venueId: string;
let turfId: string;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[Venue, Turf, Booking].map((m) => (m as typeof Venue).deleteMany({}).setOptions({ crossTenant: true })),
  ]);
  ({ ownerId } = await seedOwner(buildTestApp().services));
  venueId = (await seedVenue(ownerId, { name: 'Arena', published: true, slug: 'arena' })).id as string;
  turfId = (await seedTurf(ownerId, venueId, { name: 'Court 2' })).id as string;
});

let n = 0;
async function booking(over: Record<string, unknown> = {}) {
  n += 1;
  const startAt = new Date(Date.UTC(2026, 0, 10, 12 + (n % 8)));
  const endAt = new Date(startAt.getTime() + 3_600_000);
  return Booking.create({
    ownerId, venueId, turfId, reference: `R${n}XYZ`, businessDate: D, startAt, endAt,
    slots: [{ startAt, endAt, price: 1500 }], addons: [], currency: 'BDT', subtotal: 1500, addonsTotal: 0,
    total: 1500, advanceRequired: 0, amountPaid: 0, status: 'pending', paymentStatus: 'unpaid', source: 'online',
    policySnapshot: { paymentPolicy: { type: 'none' }, refundRules: [] },
    ...over,
  });
}

describe('owner booking JSON', () => {
  it("adds the registered player's name, phone and email", async () => {
    const u = await User.create({ name: 'Rafi', email: 'rafi@test.local', phone: '+8801711111111' });
    const out = await ownerBookingJson(await booking({ playerId: u._id }));
    expect(out.customer).toEqual({ name: 'Rafi', phone: '+8801711111111', email: 'rafi@test.local' });
  });

  it('uses the guest name and phone for guest bookings', async () => {
    const out = await ownerBookingJson(await booking({ guest: { name: 'Guest', phone: '+8801722222222' } }));
    expect(out.customer).toEqual({ name: 'Guest', phone: '+8801722222222', email: null });
  });

  it('customer is null when the player no longer exists', async () => {
    const u = await User.create({ name: 'Gone' });
    const b = await booking({ playerId: u._id });
    await User.deleteOne({ _id: u._id });
    expect((await ownerBookingJson(b)).customer).toBeNull();
  });

  it('adds the turf name', async () => {
    const out = await ownerBookingJson(await booking({ guest: { name: 'G', phone: '+8801722222222' } }));
    expect(out.turf).toEqual({ name: 'Court 2' });
  });

  it('batches users and turfs', async () => {
    const u = await User.create({ name: 'Rafi' });
    const bs = [await booking({ playerId: u._id }), await booking({ playerId: u._id })];
    const userFind = vi.spyOn(User, 'find');
    const turfFind = vi.spyOn(Turf, 'find');
    const out = await ownerBookingsJson(bs);
    expect(out).toHaveLength(2);
    expect(userFind).toHaveBeenCalledTimes(1);
    expect(turfFind).toHaveBeenCalledTimes(1);
  });
});
