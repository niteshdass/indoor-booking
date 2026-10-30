import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Booking, type BookingDoc } from '../../src/bookings/booking.model';
import { Payment } from '../../src/bookings/payment.model';
import { Notification } from '../../src/notifications/notification.model';
import { newReference } from '../../src/bookings/reference';
import { Refund } from '../../src/payments/refund.model';
import { dispatchRefund, reconcileRefunds } from '../../src/payments/refunds';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(), Booking.init(), Payment.init(),
    Refund.init(), Notification.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const cross = { crossTenant: true };

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let staff: Awaited<ReturnType<typeof addMember>>;
let venueId: string;
let turfId: string;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Booking, Payment, Refund, Notification].map((m) => (m as typeof Venue).deleteMany({}).setOptions(cross)),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
  staff = await addMember(ctx.services, owner.ownerId, { roleKey: 'staff' });
  const venue = await seedVenue(owner.ownerId, { published: true });
  const turf = await seedTurf(owner.ownerId, venue.id as string);
  venueId = venue.id as string;
  turfId = turf.id as string;
});

const send = (path: string, token: string, body: object = {}) =>
  request(ctx.app).post(`/api/v1/owners/${owner.ownerId}${path}`).set(...bearer(token)).send(body);
const refundsOf = (bookingId: unknown) => Refund.find({ bookingId }).setOptions(cross).sort({ _id: 1 }).lean();

/** A confirmed 3000 booking paid by a verified bKash transfer. */
async function walletBooking() {
  const startAt = new Date('2026-01-05T12:00:00Z');
  const endAt = new Date(startAt.getTime() + 3600_000);
  const player = await User.create({ name: 'Player', email: 'player@test.local', emailVerified: true });
  const booking: BookingDoc = await Booking.create({
    ownerId: owner.ownerId, venueId, playerId: player._id, turfId, reference: newReference(), businessDate: '2026-01-05', startAt, endAt,
    slots: [{ startAt, endAt, price: 3000 }], addons: [], currency: 'BDT', subtotal: 3000, addonsTotal: 0,
    total: 3000, advanceRequired: 0, amountPaid: 3000, status: 'confirmed', paymentStatus: 'paid', source: 'online',
    policySnapshot: { paymentPolicy: null, refundRules: [] },
  });
  const payment = await Payment.create({
    ownerId: owner.ownerId, venueId, bookingId: booking._id, method: 'wallet', kind: 'manual', provider: 'bkash',
    trxId: '9A1B2C3D4E', senderNumber: '+8801812345678', amount: 3000, currency: 'BDT', status: 'succeeded',
  });
  return { booking, payment };
}

/** The wallet booking cancelled by staff, so a wallet refund waits to be sent. */
async function cancelled() {
  const { booking, payment } = await walletBooking();
  const res = await send(`/bookings/${booking._id}/cancel`, owner.token);
  expect(res.status).toBe(200);
  const [refund] = await refundsOf(booking._id);
  return { booking, payment, refund: refund!, res };
}

describe('wallet refunds', () => {
  it('cancelling a booking paid by wallet makes a refund to send', async () => {
    const { booking, payment, refund } = await cancelled();
    expect(refund).toMatchObject({ method: 'wallet', status: 'pending', amount: 3000, reason: 'cancellation', gateway: null });
    expect(String(refund.paymentId)).toBe(String(payment._id));
    expect(ctx.services.stripe.calls.filter((c) => c.method === 'refunds.create')).toHaveLength(0);
    expect(await Payment.findById(payment._id).setOptions(cross).lean()).toMatchObject({ refundedAmount: 3000 });
    expect(await Booking.findById(booking._id).setOptions(cross).lean()).toMatchObject({ amountRefunded: 3000 });
  });

  it('the cancellation preview counts the wallet part', async () => {
    const { booking } = await walletBooking();
    const res = await request(ctx.app).get(`/api/v1/owners/${owner.ownerId}/bookings/${booking._id}/cancellation`).set(...bearer(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.preview).toMatchObject({ amount: 3000, card: 0, wallet: 3000, cash: 0 });
  });

  it('a wallet refund is never dispatched or reconciled', async () => {
    const { refund } = await cancelled();
    expect(await dispatchRefund(String(refund._id), owner.ownerId, { config: ctx.config, services: ctx.services })).toBe(false);
    await reconcileRefunds(new Date(ctx.services.now().getTime() + 24 * 3600_000), { config: ctx.config, services: ctx.services });
    expect(await Refund.findById(refund._id).setOptions(cross).lean()).toMatchObject({ status: 'pending', attempts: 0, dispatchedAt: null });
    expect(ctx.services.stripe.calls.filter((c) => c.method === 'refunds.create')).toHaveLength(0);
  });

  it('mark sent settles the refund and tells the player', async () => {
    const { booking, refund } = await cancelled();
    const res = await send(`/refunds/${refund._id}/mark-sent`, owner.token, { trxId: ' 8k2m3n4p5q ' });
    expect(res.status).toBe(200);
    expect(res.body.refund).toMatchObject({ id: String(refund._id), status: 'succeeded', trxId: '8K2M3N4P5Q' });
    const row = await Refund.findById(refund._id).setOptions(cross).lean();
    expect(row).toMatchObject({ status: 'succeeded', trxId: '8K2M3N4P5Q' });
    expect(String(row!.by)).toBe(owner.userId);
    expect(await Notification.countDocuments({ bookingId: booking._id, event: 'refund_issued' }).setOptions(cross)).toBe(1);
  });

  it('mark sent twice is 409', async () => {
    const { refund } = await cancelled();
    expect((await send(`/refunds/${refund._id}/mark-sent`, owner.token, { trxId: '8K2M3N4P5Q' })).status).toBe(200);
    const again = await send(`/refunds/${refund._id}/mark-sent`, owner.token, { trxId: '8K2M3N4P5Q' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('invalid_transition');
    expect(await Notification.countDocuments({ event: 'refund_issued' }).setOptions(cross)).toBe(1);
  });

  it('mark sent needs a valid transaction ID', async () => {
    const { refund } = await cancelled();
    for (const body of [{}, { trxId: '' }, { trxId: 'no' }, { trxId: 5 }]) {
      const res = await send(`/refunds/${refund._id}/mark-sent`, owner.token, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_trx_id');
    }
    expect((await Refund.findById(refund._id).setOptions(cross).lean())!.status).toBe('pending');
  });

  it('mark sent only applies to a wallet refund', async () => {
    const { booking, payment } = await walletBooking();
    const card = await Refund.create({
      ownerId: owner.ownerId, venueId, bookingId: booking._id, paymentId: payment._id, amount: 100, currency: 'BDT',
      reason: 'cancellation', method: 'cash', status: 'pending',
    });
    const res = await send(`/refunds/${card._id}/mark-sent`, owner.token, { trxId: '8K2M3N4P5Q' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('invalid_transition');
  });

  it('mark sent needs payment.verify', async () => {
    const { refund } = await cancelled();
    const res = await send(`/refunds/${refund._id}/mark-sent`, staff.token, { trxId: '8K2M3N4P5Q' });
    expect(res.status).toBe(403);
    expect((await Refund.findById(refund._id).setOptions(cross).lean())!.status).toBe('pending');
  });

  it('owner refund JSON shows where to send it', async () => {
    const { booking, res } = await cancelled();
    expect(res.body.refunds[0]).toMatchObject({ method: 'wallet', trxId: null, provider: 'bkash', sendTo: '+8801812345678' });
    const detail = await request(ctx.app).get(`/api/v1/owners/${owner.ownerId}/bookings/${booking._id}`).set(...bearer(owner.token));
    expect(detail.body.refunds[0]).toMatchObject({ provider: 'bkash', sendTo: '+8801812345678' });
  });
});
