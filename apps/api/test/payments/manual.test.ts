import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { MANUAL_HOLD_MINUTES, hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { signAccessToken } from '../../src/auth/jwt';
import { seedOwner, bearer } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
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
import { PaymentGatewayAccount } from '../../src/payments/gateway.model';
import { expireHolds } from '../../src/jobs/sweeps';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Booking.init(), SlotLock.init(), Payment.init(), PaymentGatewayAccount.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const TZ = 'Asia/Dhaka';
// The clock starts 2026-01-01T00:00Z, so this is the next day.
const D = '2026-01-02';
const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '23:00' }]),
);
const at = (hm: string) => localToUtc(D, hmToMin(hm), TZ).toISOString();
const cross = { crossTenant: true };
const MIN = 60_000;
const BKASH = { provider: 'bkash', number: '+8801712345678', accountType: 'personal' };
const SUBMIT = { provider: 'bkash', trxId: '9a1b 2c3d4e', senderNumber: '01812345678' };

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let slug: string;
let turfId: string;

async function newPlayer() {
  const u = await User.create({ name: 'Player', email: `p${Math.random()}@test.local` });
  return { userId: u.id as string, token: await signAccessToken(u.id as string, ctx.config.jwtSecret, ctx.services.now()) };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;
/** The player with a token signed now, since access tokens outlive a 15-minute hold by nothing. */
const resign = async (p: Player) => ({ ...p, token: await signAccessToken(p.userId, ctx.config.jwtSecret, ctx.services.now()) });

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Booking, SlotLock, Payment, PaymentGatewayAccount].map(
      (m) => (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
  // bKash only, no cards: a 3000 game holds for a 600 advance.
  const venue = await seedVenue(owner.ownerId, {
    published: true,
    slug: `arena-${Math.random().toString(36).slice(2, 8)}`,
    timezone: TZ,
    settings: {
      hours: HOURS,
      bookingWindowDays: 365,
      paymentPolicy: { type: 'partial_percent', percent: 20 },
      paymentMethods: { manualWallets: [BKASH], gateways: [] },
    },
  });
  const turf = await seedTurf(owner.ownerId, venue.id as string, { pricing: { base: 3000, rules: [] } });
  slug = venue.slug;
  turfId = turf.id as string;
});

async function book(player: Player, hm = '18:00', more: object[] = []) {
  const res = await request(ctx.app)
    .post(`/api/v1/venues/${slug}/turfs/${turfId}/bookings`)
    .set(...bearer(player.token))
    .send({ date: D, startAts: [at(hm)], more });
  expect(res.status).toBe(201);
  expect(res.body.booking.status).toBe('awaiting_payment');
  return res.body as { booking: { id: string; holdExpiresAt: string }; bookings?: { id: string }[] };
}

const submit = (player: Player, bookingId: string, body: object = SUBMIT) =>
  request(ctx.app).post(`/api/v1/bookings/${bookingId}/payments/manual`).set(...bearer(player.token)).send(body);

const bookingOf = async (id: string) => (await Booking.findById(id).setOptions(cross))!;
const paymentsOf = (bookingId: string) => Payment.find({ bookingId }).setOptions(cross).sort({ _id: 1 });
const locksOf = (bookingId: string) => SlotLock.countDocuments({ ownerId: owner.ownerId, bookingId });

describe('POST /bookings/:id/payments/manual', () => {
  it('submit moves the hold to pending and records a pending wallet payment', async () => {
    const player = await newPlayer();
    const { booking } = await book(player);
    const res = await submit(player, booking.id);
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('pending');
    expect(res.body.booking).toMatchObject({ id: booking.id, status: 'pending', holdExpiresAt: null, amountPaid: 0 });

    const fresh = await bookingOf(booking.id);
    expect(fresh).toMatchObject({ status: 'pending', holdExpiresAt: null, amountPaid: 0 });
    expect(await locksOf(booking.id)).toBe(1);
    const rows = await paymentsOf(booking.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      method: 'wallet',
      kind: 'manual',
      status: 'pending',
      provider: 'bkash',
      trxId: '9A1B2C3D4E',
      senderNumber: '+8801812345678',
      amount: 600,
      currency: 'BDT',
      verifiedBy: null,
      verifiedAt: null,
    });
    const logs = await ActivityLog.find({ ownerId: owner.ownerId, action: 'booking.pending' }).lean();
    expect(logs).toHaveLength(1);
    expect(String(logs[0]!.actorId)).toBe(player.userId);

    // A second submit for the same booking is refused while the first waits.
    const again = await submit(player, booking.id, { ...SUBMIT, trxId: 'ZZZZ99998888' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('payment_submitted');
  });

  it('submit for a group makes one row per booking with the TrxID on the lead only', async () => {
    const player = await newPlayer();
    const body = await book(player, '18:00', [{ date: D, startAts: [at('20:00')] }]);
    const ids = body.bookings!.map((b) => b.id);
    expect(ids).toHaveLength(2);

    const options = await request(ctx.app).get(`/api/v1/bookings/${ids[1]}/payment-options`).set(...bearer(player.token));
    expect(options.status).toBe(200);
    expect(options.body.amount).toBe(1200);

    const res = await submit(player, ids[1]!);
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('pending');
    const rows = await Payment.find({ kind: 'manual' }).setOptions(cross).sort({ _id: 1 });
    expect(rows).toHaveLength(2);
    expect(rows.map((p) => String(p.bookingId))).toEqual(ids);
    expect(rows.map((p) => p.trxId)).toEqual(['9A1B2C3D4E', null]);
    expect(rows.reduce((n, p) => n + p.amount, 0)).toBe(1200);
    const groupId = (await bookingOf(ids[0]!)).groupId;
    expect(groupId).not.toBeNull();
    expect(rows.every((p) => String(p.groupId) === String(groupId))).toBe(true);
    for (const id of ids) expect((await bookingOf(id)).status).toBe('pending');
    // Both bookings show the lead's submission.
    const other = await request(ctx.app).get(`/api/v1/me/bookings/${ids[1]}`).set(...bearer(player.token));
    expect(other.body.booking.manualPayment).toMatchObject({ trxId: '9A1B2C3D4E', status: 'pending' });
  });

  it('same TrxID twice is 409 trx_id_used', async () => {
    const player = await newPlayer();
    const first = await book(player, '18:00');
    const second = await book(player, '20:00');
    expect((await submit(player, first.booking.id)).status).toBe(201);
    const res = await submit(player, second.booking.id, { ...SUBMIT, trxId: '9A1B2C3D4E' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'trx_id_used', message: 'This Transaction ID was already used' });
    expect((await bookingOf(second.booking.id)).status).toBe('awaiting_payment');
    expect(await paymentsOf(second.booking.id)).toHaveLength(0);
  });

  it('TrxID of a verified payment cannot be reused', async () => {
    const player = await newPlayer();
    const first = await book(player, '18:00');
    const second = await book(player, '20:00');
    expect((await submit(player, first.booking.id)).status).toBe(201);
    await Payment.updateOne({ bookingId: first.booking.id }, { $set: { status: 'succeeded' } }).setOptions(cross);
    const res = await submit(player, second.booking.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('trx_id_used');
  });

  it('TrxID can be reused after the payment was marked not received', async () => {
    const player = await newPlayer();
    const first = await book(player, '18:00');
    const second = await book(player, '20:00');
    expect((await submit(player, first.booking.id)).status).toBe(201);
    await Payment.updateOne({ bookingId: first.booking.id }, { $set: { status: 'failed' } }).setOptions(cross);
    const res = await submit(player, second.booking.id);
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('pending');
  });

  it('late submit revives the booking when slots are free', async () => {
    const player = await newPlayer();
    const { booking } = await book(player);
    ctx.services.clock.advance((MANUAL_HOLD_MINUTES + 1) * MIN);
    expect(await expireHolds(ctx.services.now())).toBe(1);
    expect((await bookingOf(booking.id)).status).toBe('expired');
    expect(await locksOf(booking.id)).toBe(0);

    const res = await submit(await resign(player), booking.id);
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('pending');
    expect(await bookingOf(booking.id)).toMatchObject({ status: 'pending', holdExpiresAt: null, amountPaid: 0 });
    expect(await locksOf(booking.id)).toBe(1);
    expect(await paymentsOf(booking.id)).toHaveLength(1);
    expect(await ActivityLog.countDocuments({ ownerId: owner.ownerId, action: 'booking.revived' })).toBe(1);
  });

  it('late submit when slots are taken records the payment and keeps the booking expired', async () => {
    const player = await newPlayer();
    const { booking } = await book(player);
    ctx.services.clock.advance((MANUAL_HOLD_MINUTES + 1) * MIN);
    await expireHolds(ctx.services.now());
    const other = await newPlayer();
    await book(other);

    const res = await submit(await resign(player), booking.id);
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('slots_taken');
    expect(res.body.booking.status).toBe('expired');
    expect((await bookingOf(booking.id)).status).toBe('expired');
    expect(await locksOf(booking.id)).toBe(0);
    const rows = await paymentsOf(booking.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', kind: 'manual', trxId: '9A1B2C3D4E', amount: 600 });
  });

  it('rejects a provider the venue does not offer', async () => {
    const player = await newPlayer();
    const { booking } = await book(player);
    const res = await submit(player, booking.id, { ...SUBMIT, provider: 'nagad' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('payments_unavailable');
    expect(await paymentsOf(booking.id)).toHaveLength(0);
  });

  it('rejects a bad TrxID or sender number', async () => {
    const player = await newPlayer();
    const { booking } = await book(player);
    const bad = await submit(player, booking.id, { ...SUBMIT, trxId: 'abc' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_trx_id');
    const sender = await submit(player, booking.id, { ...SUBMIT, senderNumber: '+14155550100' });
    expect(sender.status).toBe(400);
    expect(sender.body.error.code).toBe('invalid_sender');
    expect(JSON.stringify(sender.body)).not.toContain('4155550100');
  });

  it("is 404 on another player's booking", async () => {
    const player = await newPlayer();
    const { booking } = await book(player);
    const res = await submit(await newPlayer(), booking.id);
    expect(res.status).toBe(404);
  });
});

describe('GET /bookings/:id/payment-options', () => {
  it("payment-options shows the venue numbers to the booking's player only", async () => {
    const player = await newPlayer();
    const { booking } = await book(player);
    const res = await request(ctx.app).get(`/api/v1/bookings/${booking.id}/payment-options`).set(...bearer(player.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      wallets: [BKASH],
      card: false,
      sslcommerz: false,
      amount: 600,
      currency: 'BDT',
      holdExpiresAt: booking.holdExpiresAt,
    });

    const stranger = await newPlayer();
    const other = await request(ctx.app).get(`/api/v1/bookings/${booking.id}/payment-options`).set(...bearer(stranger.token));
    expect(other.status).toBe(404);
    expect(JSON.stringify(other.body)).not.toContain('8801712345678');
  });
});

describe('player booking JSON', () => {
  it('player JSON never includes senderNumber', async () => {
    const player = await newPlayer();
    const { booking } = await book(player);
    const res = await submit(player, booking.id);
    expect(res.status).toBe(201);
    expect(res.body.booking.manualPayment).toEqual({
      provider: 'bkash',
      trxId: '9A1B2C3D4E',
      amount: 600,
      status: 'pending',
      submittedAt: ctx.services.now().toISOString(),
    });
    expect(JSON.stringify(res.body)).not.toContain('8801812345678');

    const detail = await request(ctx.app).get(`/api/v1/me/bookings/${booking.id}`).set(...bearer(player.token));
    expect(detail.body.booking.manualPayment).toMatchObject({ trxId: '9A1B2C3D4E' });
    expect(JSON.stringify(detail.body)).not.toContain('8801812345678');
    const list = await request(ctx.app).get('/api/v1/me/bookings').set(...bearer(player.token));
    expect(list.body.bookings[0].manualPayment).toMatchObject({ trxId: '9A1B2C3D4E' });
    expect(JSON.stringify(list.body)).not.toContain('8801812345678');
  });

  it('is null without a manual payment', async () => {
    const player = await newPlayer();
    const { booking } = await book(player);
    const detail = await request(ctx.app).get(`/api/v1/me/bookings/${booking.id}`).set(...bearer(player.token));
    expect(detail.body.booking.manualPayment).toBeNull();
  });
});

describe('hold length', () => {
  it('manual-only venue holds for 15 minutes', async () => {
    const player = await newPlayer();
    const { booking } = await book(player);
    expect(new Date(booking.holdExpiresAt).getTime() - ctx.services.now().getTime()).toBe(MANUAL_HOLD_MINUTES * MIN);
  });
});
