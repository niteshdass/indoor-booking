import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { signAccessToken } from '../../src/auth/jwt';
import { seedOwner, bearer } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { OtpCode } from '../../src/auth/otp.model';
import { OtpThrottle } from '../../src/auth/otpThrottle.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Closure } from '../../src/schedule/closure.model';
import { SlotOverride } from '../../src/schedule/slotOverride.model';
import { Addon } from '../../src/addons/addon.model';
import { AddonAssignment } from '../../src/addons/assignment.model';
import { Booking } from '../../src/bookings/booking.model';
import { SlotLock } from '../../src/bookings/slotLock.model';
import { Payment } from '../../src/bookings/payment.model';
import { Refund } from '../../src/payments/refund.model';
import { MAX_GUEST_PENDING, MAX_OPEN_HOLDS } from '../../src/bookings/routes/public';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init(), Turf.init(), Closure.init(),
    SlotOverride.init(), Addon.init(), AddonAssignment.init(), Booking.init(), SlotLock.init(), Payment.init(),
    OtpCode.init(), OtpThrottle.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const TZ = 'Asia/Dhaka';
const D = '2026-01-10';
const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '23:00' }]),
);
const at = (hm: string) => localToUtc(D, hmToMin(hm), TZ).toISOString();
const PHONE = '+8801711111111';

let ctx: ReturnType<typeof buildTestApp>;
let ownerId: string;
let slug: string;
let turfId: string;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), OtpCode.deleteMany({}), OtpThrottle.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[Venue, Turf, Closure, SlotOverride, Addon, AddonAssignment, Booking, SlotLock, Payment, Refund].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions({ crossTenant: true }),
    ),
  ]);
  ctx = buildTestApp();
  ({ ownerId } = await seedOwner(ctx.services));
  await setup();
});

async function setup(settings: Record<string, unknown> = {}, published = true) {
  const venue = await seedVenue(ownerId, {
    published,
    slug: `arena-${Math.random().toString(36).slice(2, 8)}`,
    timezone: TZ,
    settings: { hours: HOURS, bookingWindowDays: 365, ...settings },
  });
  const turf = await seedTurf(ownerId, venue.id as string, { pricing: { base: 1500, rules: [] } });
  slug = venue.slug;
  turfId = turf.id as string;
  return { venue, turf };
}

const base = () => `/api/v1/venues/${slug}/turfs/${turfId}`;
const post = (path: string, body: unknown, auth?: string) => {
  const r = request(ctx.app).post(path);
  if (auth) r.set(...bearer(auth));
  return r.send(body as object);
};
const guestBody = (over: Record<string, unknown> = {}, hms = ['18:00']) => ({
  date: D,
  startAts: hms.map(at),
  guest: { name: 'Иван Петров', phone: PHONE, otpCode: '123456' },
  ...over,
});
async function newPlayer() {
  const u = await User.create({ name: 'Player', email: `p${Math.random()}@test.local` });
  return { userId: u.id as string, token: await signAccessToken(u.id as string, ctx.config.jwtSecret, ctx.services.now()) };
}
const requestOtpFor = () => post(`/api/v1/venues/${slug}/bookings/otp`, { phone: PHONE });

describe('quote', () => {
  it('prices two slots plus a towel', async () => {
    const towel = await Addon.create({ ownerId, name: 'Towel', pricingType: 'per_booking', price: 50, currency: 'BDT' });
    await AddonAssignment.create({ ownerId, addonId: towel._id, venueId: (await Venue.findOne({ slug }).setOptions({ crossTenant: true }))!._id, turfId: null, enabled: true });
    const res = await post(`${base()}/quote`, { date: D, startAts: [at('18:00'), at('19:00')], addons: [{ addonId: towel.id }] });
    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({ currency: 'BDT', subtotal: 3000, addonsTotal: 50, total: 3050, advanceRequired: 0 });
    expect(res.body.quote.slots[0].startAt).toBe(at('18:00'));
    expect(res.body.guestAllowed).toBe(true);
    expect(res.body.guestOtpRequired).toBe(true);
  });

  it('quote lists offered methods without numbers', async () => {
    const wallets = ['bkash', 'nagad'].map((provider) => ({ provider, number: '+8801712345678', accountType: 'personal' }));
    await Venue.updateOne(
      { ownerId, slug },
      { $set: { 'settings.paymentMethods': { manualWallets: wallets, gateways: ['stripe'] } } },
    );
    const res = await post(`${base()}/quote`, { date: D, startAts: [at('18:00')] });
    expect(res.status).toBe(200);
    expect(res.body.paymentMethods).toEqual({ wallets: ['bkash', 'nagad'], card: false });
    expect(JSON.stringify(res.body)).not.toContain('+8801');
  });

  it('404s for unknown slug, unpublished venue, inactive turf', async () => {
    const body = { date: D, startAts: [at('18:00')] };
    expect((await post(`/api/v1/venues/nope/turfs/${turfId}/quote`, body)).status).toBe(404);
    expect((await post(`/api/v1/venues/${slug}/turfs/000000000000000000000000/quote`, body)).status).toBe(404);
    await Turf.updateOne({ ownerId, _id: turfId }, { active: false });
    expect((await post(`${base()}/quote`, body)).status).toBe(404);
    await Venue.updateOne({ ownerId, slug }, { published: false });
    expect((await post(`${base()}/quote`, body)).status).toBe(404);
  });
});

describe('registered booking', () => {
  it('confirms, lists, hides from others, rejects a bad token', async () => {
    const { userId, token } = await newPlayer();
    const res = await post(`${base()}/bookings`, { date: D, startAts: [at('18:00')] }, token);
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ status: 'confirmed', playerId: userId, guest: null });

    const list = await request(ctx.app).get('/api/v1/me/bookings').set(...bearer(token));
    expect(list.body.bookings.map((b: { id: string }) => b.id)).toEqual([res.body.booking.id]);
    const one = await request(ctx.app).get(`/api/v1/me/bookings/${res.body.booking.id}`).set(...bearer(token));
    expect(one.status).toBe(200);

    const other = await newPlayer();
    const hidden = await request(ctx.app).get(`/api/v1/me/bookings/${res.body.booking.id}`).set(...bearer(other.token));
    expect(hidden.status).toBe(404);
    expect((await request(ctx.app).get('/api/v1/me/bookings')).status).toBe(401);

    const bad = await post(`${base()}/bookings`, guestBody(), 'garbage');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('invalid_token');
    expect(await Booking.countDocuments({}).setOptions({ crossTenant: true })).toBe(1);
  });

  it('rejects a guest object from a signed-in player', async () => {
    const { token } = await newPlayer();
    expect((await post(`${base()}/bookings`, guestBody(), token)).status).toBe(400);
  });
});

describe('guest booking with OTP', () => {
  it('books after an OTP request', async () => {
    const otp = await requestOtpFor();
    expect(otp.status).toBe(200);
    expect(otp.body).toEqual({ expiresInSec: 300, resendInSec: 60 });
    expect(ctx.services.sms.sent).toHaveLength(1);
    const res = await post(`${base()}/bookings`, guestBody({ guest: { name: 'Иван Петров', phone: '+880 1711-111111', otpCode: '123456' } }));
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ status: 'pending', playerId: null, guest: { name: 'Иван Петров', phone: PHONE } });
    expect(res.body.booking.reference).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  it('wrong code, missing code, and requireOtp false', async () => {
    await requestOtpFor();
    const wrong = await post(`${base()}/bookings`, guestBody({ guest: { name: 'A', phone: PHONE, otpCode: '000000' } }));
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('otp_invalid');
    const none = await post(`${base()}/bookings`, guestBody({ guest: { name: 'A', phone: PHONE } }));
    expect(none.body.error.code).toBe('otp_required');
    expect(none.status).toBe(400);
    expect(await Booking.countDocuments({}).setOptions({ crossTenant: true })).toBe(0);

    await setup({ guestBooking: { allowed: true, requireOtp: false } });
    const q = await post(`${base()}/quote`, { date: D, startAts: [at('18:00')] });
    expect(q.body.guestOtpRequired).toBe(false);
    const ok = await post(`${base()}/bookings`, guestBody({ guest: { name: 'A', phone: PHONE } }));
    expect(ok.status).toBe(201);
  });

  it('anonymous without guest is 401', async () => {
    const res = await post(`${base()}/bookings`, { date: D, startAts: [at('18:00')] });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });
});

describe('guest lookup', () => {
  it('matches reference and phone only', async () => {
    await requestOtpFor();
    const created = await post(`${base()}/bookings`, guestBody());
    const ref = created.body.booking.reference as string;
    const ok = await request(ctx.app).post('/api/v1/bookings/lookup').send({ reference: ref, phone: '+880 1711 111111' });
    expect(ok.status).toBe(200);
    expect(ok.body.booking.id).toBe(created.body.booking.id);
    const wrongPhone = await request(ctx.app).post('/api/v1/bookings/lookup').send({ reference: ref, phone: '+8801722222222' });
    const unknown = await request(ctx.app).post('/api/v1/bookings/lookup').send({ reference: 'ZZZZZZZZ', phone: PHONE });
    expect(wrongPhone.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(wrongPhone.body).toEqual(unknown.body);
  });
});

describe('guest disabled', () => {
  it('advance venue: quote, create and OTP refuse guests; players get awaiting_payment', async () => {
    await setup({ paymentPolicy: { type: 'partial_percent', percent: 20 }, guestBooking: { allowed: true, requireOtp: true } });
    const q = await post(`${base()}/quote`, { date: D, startAts: [at('18:00')] });
    expect(q.body.guestAllowed).toBe(false);
    expect(q.body.quote.advanceRequired).toBe(300);
    const g = await post(`${base()}/bookings`, guestBody());
    expect(g.status).toBe(403);
    expect(g.body.error.code).toBe('guest_booking_disabled');
    expect((await requestOtpFor()).status).toBe(403);
    const { token } = await newPlayer();
    const p = await post(`${base()}/bookings`, { date: D, startAts: [at('18:00')] }, token);
    expect(p.status).toBe(201);
    expect(p.body.booking.status).toBe('awaiting_payment');
  });

  it('guestBooking.allowed false, and no code is consumed', async () => {
    await setup({ guestBooking: { allowed: false, requireOtp: true } });
    expect((await requestOtpFor()).status).toBe(403);
    expect(ctx.services.sms.sent).toHaveLength(0);
    const g = await post(`${base()}/bookings`, guestBody());
    expect(g.status).toBe(403);
    expect(g.body.error.code).toBe('guest_booking_disabled');
  });
});

describe('quote errors reach the client', () => {
  it('non-consecutive, out of stock, concurrent same slot', async () => {
    const { token } = await newPlayer();
    const nc = await post(`${base()}/bookings`, { date: D, startAts: [at('10:00'), at('12:00')] }, token);
    expect(nc.status).toBe(400);
    expect(nc.body.error.code).toBe('slots_not_consecutive');

    const venue = (await Venue.findOne({ slug }).setOptions({ crossTenant: true }))!;
    const racket = await Addon.create({ ownerId, name: 'Racket', pricingType: 'per_unit', price: 100, currency: 'BDT', stock: 1 });
    await AddonAssignment.create({ ownerId, addonId: racket._id, venueId: venue._id, turfId: null, enabled: true });
    const sel = [{ addonId: racket.id, quantity: 1 }];
    expect((await post(`${base()}/bookings`, { date: D, startAts: [at('10:00')], addons: sel }, token)).status).toBe(201);
    const out = await post(`${base()}/bookings`, { date: D, startAts: [at('12:00')], addons: [{ addonId: racket.id, quantity: 2 }] }, token);
    expect(out.status).toBe(409);
    expect(out.body.error.code).toBe('addon_out_of_stock');
    expect(out.body.error.details.addonId).toBe(racket.id);

    const results = await Promise.all([
      post(`${base()}/bookings`, { date: D, startAts: [at('18:00')] }, token),
      post(`${base()}/bookings`, { date: D, startAts: [at('18:00')] }, token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('slot_taken');
  }, 60_000);
});

describe('validation', () => {
  it('rejects bad input with validation_error', async () => {
    const many = Array.from({ length: 13 }, () => at('18:00'));
    const bodies = [
      guestBody({ startAts: many }),
      guestBody({ date: '2026-02-30' }),
      guestBody({ guest: { name: '', phone: PHONE, otpCode: '123456' } }),
      guestBody({ guest: { name: 'x'.repeat(81), phone: PHONE, otpCode: '123456' } }),
      guestBody({ guest: { name: 'x'.repeat(101), phone: PHONE, otpCode: '123456' } }),
      guestBody({ extra: 1 }),
    ];
    for (const b of bodies) {
      const res = await post(`${base()}/bookings`, b);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
    expect((await post(`${base()}/quote`, { date: D, startAts: [at('18:00')], extra: 1 })).status).toBe(400);
  });
});

describe('guest OTP rate limit', () => {
  it('429 rate_limited on the 11th code in an hour from one address, whatever the phone', async () => {
    ctx = buildTestApp({ services: ctx.services, rateLimit: true });
    const codes: string[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await post(`/api/v1/venues/${slug}/bookings/otp`, { phone: `+88017${String(10000000 + i)}` });
      codes.push(res.body.error?.code ?? 'ok');
    }
    expect(codes.slice(0, 10)).not.toContain('rate_limited');
    expect(codes[10]).toBe('rate_limited');
    // One bucket for every code-sending route: the sign-in OTP is refused too.
    const login = await post('/api/v1/auth/otp/request', { phone: '+8801799999999' });
    expect(login.body.error.code).toBe('rate_limited');
  });

  it('lookup is rate limited: 429 on the 31st guess', async () => {
    ctx = buildTestApp({ services: ctx.services, rateLimit: true });
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await post('/api/v1/bookings/lookup', { reference: `ZZ${i}`, phone: PHONE })).status);
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe('hold caps', () => {
  it('a player with MAX_OPEN_HOLDS live unpaid holds cannot hold another until they lapse', async () => {
    const { userId, token } = await newPlayer();
    const hours = Array.from({ length: MAX_OPEN_HOLDS }, (_, i) => `${String(8 + i).padStart(2, '0')}:00`);
    for (const hm of hours) expect((await post(`${base()}/bookings`, { date: D, startAts: [at(hm)] }, token)).status).toBe(201);
    const later = new Date(ctx.services.now().getTime() + 10 * 60_000);
    await Booking.updateMany({ playerId: userId }, { $set: { status: 'awaiting_payment', holdExpiresAt: later } }).setOptions({ crossTenant: true });

    const refused = await post(`${base()}/bookings`, { date: D, startAts: [at('22:00')] }, token);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('too_many_holds');

    ctx.services.clock.advance(11 * 60_000);
    expect((await post(`${base()}/bookings`, { date: D, startAts: [at('22:00')] }, token)).status).toBe(201);
  });

  it('one guest phone may have MAX_GUEST_PENDING bookings waiting', async () => {
    await setup({ guestBooking: { allowed: true, requireOtp: false } });
    const hours = Array.from({ length: MAX_GUEST_PENDING }, (_, i) => `${String(8 + i).padStart(2, '0')}:00`);
    for (const hm of hours) expect((await post(`${base()}/bookings`, guestBody({}, [hm]))).status).toBe(201);
    const refused = await post(`${base()}/bookings`, guestBody({}, ['20:00']));
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('too_many_holds');
    // Another phone is unaffected.
    const other = await post(`${base()}/bookings`, guestBody({ guest: { name: 'B', phone: '+8801722222222' } }, ['20:00']));
    expect(other.status).toBe(201);
  });
});

describe('Idempotency-Key', () => {
  const keyed = (body: unknown, key: string, auth?: string) => post(`${base()}/bookings`, body, auth).set('Idempotency-Key', key);
  const count = () => Booking.countDocuments({}).setOptions({ crossTenant: true });

  it('a retried player booking returns the first booking and holds nothing new', async () => {
    const { token } = await newPlayer();
    const body = { date: D, startAts: [at('18:00')] };
    const first = await keyed(body, 'checkout-1111', token);
    expect(first.status).toBe(201);
    const again = await keyed(body, 'checkout-1111', token);
    expect(again.status).toBe(201);
    expect(again.body.booking.id).toBe(first.body.booking.id);
    expect(await count()).toBe(1);
  });

  it('two copies sent at once make one booking', async () => {
    const { token } = await newPlayer();
    const body = { date: D, startAts: [at('18:00')] };
    const [a, b] = await Promise.all([keyed(body, 'checkout-race', token), keyed(body, 'checkout-race', token)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.booking.id).toBe(b.body.booking.id);
    expect(await count()).toBe(1);
  });

  it('a guest retry needs no second code and is not counted against the pending cap', async () => {
    await requestOtpFor();
    const first = await keyed(guestBody(), 'guest-key-1');
    expect(first.status).toBe(201);
    // The code was used up by the first request; the replay must not ask for it again.
    const again = await keyed(guestBody(), 'guest-key-1');
    expect(again.status).toBe(201);
    expect(again.body.booking.reference).toBe(first.body.booking.reference);
    expect(await count()).toBe(1);
  });

  it("keys are scoped per booker and can't be reused for another court", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const first = await keyed({ date: D, startAts: [at('18:00')] }, 'shared-key', a.token);
    const other = await keyed({ date: D, startAts: [at('19:00')] }, 'shared-key', b.token);
    expect(other.status).toBe(201);
    expect(other.body.booking.id).not.toBe(first.body.booking.id);

    await setup();
    const moved = await keyed({ date: D, startAts: [at('18:00')] }, 'shared-key', a.token);
    expect(moved.status).toBe(422);
    expect(moved.body.error.code).toBe('idempotency_key_reused');
  });

  it('a malformed key is a 400', async () => {
    const { token } = await newPlayer();
    const res = await keyed({ date: D, startAts: [at('18:00')] }, 'no spaces!', token);
    expect(res.status).toBe(400);
    expect(await count()).toBe(0);
  });
});

describe('guest gate at venue level', () => {
  it('full-payment venue with a free slot still refuses guests', async () => {
    const { venue } = await setup({ paymentPolicy: { type: 'full' }, guestBooking: { allowed: true, requireOtp: false } });
    const free = await seedTurf(ownerId, venue.id as string, { pricing: { base: 0, rules: [] } });
    turfId = free.id as string;
    const q = await post(`${base()}/quote`, { date: D, startAts: [at('18:00')] });
    expect(q.status).toBe(200);
    expect(q.body.quote.advanceRequired).toBe(0);
    expect(q.body.guestAllowed).toBe(false);
    const g = await post(`${base()}/bookings`, guestBody({ guest: { name: 'A', phone: PHONE } }));
    expect(g.status).toBe(403);
    expect(g.body.error.code).toBe('guest_booking_disabled');
  });
});

describe('lookup with a malformed phone', () => {
  it('is the same 404', async () => {
    const miss = await request(ctx.app).post('/api/v1/bookings/lookup').send({ reference: 'ZZZZZZZZ', phone: PHONE });
    const bad = await request(ctx.app).post('/api/v1/bookings/lookup').send({ reference: 'ZZZZZZZZ', phone: 'abc' });
    expect(bad.status).toBe(404);
    expect(bad.body).toEqual(miss.body);
  });
});

describe('player cancellation', () => {
  /** A confirmed 18:00 booking with 1500 paid in cash; the venue refunds 50% from 24h out. */
  async function paidBooking(token: string) {
    await setup({ refundRules: [{ minHoursBefore: 24, percent: 50 }] });
    const res = await post(`${base()}/bookings`, { date: D, startAts: [at('18:00')] }, token);
    expect(res.status).toBe(201);
    const id = res.body.booking.id as string;
    const b = (await Booking.findById(id).setOptions({ crossTenant: true }))!;
    await Payment.create({
      ownerId, venueId: b.venueId, bookingId: b._id, method: 'cash', amount: 1500, currency: 'BDT', status: 'succeeded',
    });
    await Booking.updateOne({ ownerId, _id: id }, { amountPaid: 1500, paymentStatus: 'paid' });
    return id;
  }
  const getAs = (path: string, token: string) => request(ctx.app).get(`/api/v1${path}`).set(...bearer(token));

  it('player previews and cancels their own booking', async () => {
    const { token } = await newPlayer();
    const id = await paidBooking(token);
    const preview = await getAs(`/me/bookings/${id}/cancellation`, token);
    expect(preview.status).toBe(200);
    expect(preview.body.preview).toMatchObject({ percent: 50, amount: 750, amountPaid: 1500, cash: 750, card: 0 });

    const res = await post(`/api/v1/me/bookings/${id}/cancel`, { reason: 'rain' }, token);
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ id, status: 'cancelled', cancelledBy: 'player', cancelReason: 'rain' });
    expect(res.body.refunds).toHaveLength(1);
    expect(res.body.refunds[0]).toMatchObject({ amount: preview.body.preview.amount, ruleApplied: { percent: preview.body.preview.percent } });
  });

  it("player cannot cancel someone else's booking", async () => {
    const { token } = await newPlayer();
    const id = await paidBooking(token);
    const other = await newPlayer();
    expect((await getAs(`/me/bookings/${id}/cancellation`, other.token)).status).toBe(404);
    expect((await post(`/api/v1/me/bookings/${id}/cancel`, {}, other.token)).status).toBe(404);
    expect((await post(`/api/v1/me/bookings/${id}/cancel`, {})).status).toBe(401);
    expect((await Booking.findById(id).setOptions({ crossTenant: true }))!.status).toBe('confirmed');
  });

  it('player cancel after start is too_late', async () => {
    const { userId, token: early } = await newPlayer();
    const id = await paidBooking(early);
    ctx.services.clock.advance(Date.parse(at('18:30')) - ctx.services.now().getTime());
    // The first token has expired with the clock.
    const token = await signAccessToken(userId, ctx.config.jwtSecret, ctx.services.now());
    const res = await post(`/api/v1/me/bookings/${id}/cancel`, {}, token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('too_late');
    expect((await getAs(`/me/bookings/${id}/cancellation`, token)).body.error.code).toBe('too_late');
  });

  it('me booking detail lists refunds', async () => {
    const { token } = await newPlayer();
    const id = await paidBooking(token);
    expect((await getAs(`/me/bookings/${id}`, token)).body.refunds).toEqual([]);
    const cancelled = await post(`/api/v1/me/bookings/${id}/cancel`, {}, token);
    const res = await getAs(`/me/bookings/${id}`, token);
    expect(res.body.refunds).toEqual(cancelled.body.refunds);
    expect(res.body.refunds).toHaveLength(1);
  });
});

describe('guest cancellation', () => {
  async function guestBookingRef() {
    await requestOtpFor();
    const created = await post(`${base()}/bookings`, guestBody());
    expect(created.status).toBe(201);
    ctx.services.clock.advance(61_000);
    return created.body.booking.reference as string;
  }
  const lookupOtp = (reference: string, phone = PHONE) => post('/api/v1/bookings/lookup/otp', { reference, phone });
  const lastCode = () => /\d{6}/.exec(ctx.services.sms.sent.at(-1)!.text)![0];

  it('guest cancel needs a code sent to the booking phone', async () => {
    const reference = await guestBookingRef();
    const preview = await request(ctx.app).post('/api/v1/bookings/lookup/cancellation').send({ reference, phone: PHONE });
    expect(preview.status).toBe(200);
    expect(preview.body.preview).toMatchObject({ amount: 0, amountPaid: 0 });

    const none = await post('/api/v1/bookings/lookup/cancel', { reference, phone: PHONE });
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('validation_error');

    const sentBefore = ctx.services.sms.sent.length;
    const otp = await lookupOtp(reference, '+880 1711 111111');
    expect(otp.status).toBe(200);
    expect(ctx.services.sms.sent).toHaveLength(sentBefore + 1);
    expect(ctx.services.sms.sent.at(-1)!.to).toBe(PHONE);

    const wrong = await post('/api/v1/bookings/lookup/cancel', { reference, phone: PHONE, otpCode: '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('otp_invalid');

    const ok = await post('/api/v1/bookings/lookup/cancel', { reference, phone: PHONE, otpCode: lastCode(), reason: 'plans changed' });
    expect(ok.status).toBe(200);
    expect(ok.body.booking).toMatchObject({ status: 'cancelled', cancelledBy: 'guest', cancelReason: 'plans changed' });
    expect(ok.body.refunds).toEqual([]);
  });

  it('guest otp and cancel answer 404 for a wrong phone', async () => {
    const reference = await guestBookingRef();
    const sentBefore = ctx.services.sms.sent.length;
    const miss = await request(ctx.app).post('/api/v1/bookings/lookup').send({ reference, phone: '+8801722222222' });
    for (const phone of ['+8801722222222', 'abc']) {
      const otp = await lookupOtp(reference, phone);
      const cancel = await post('/api/v1/bookings/lookup/cancel', { reference, phone, otpCode: '123456' });
      const preview = await request(ctx.app).post('/api/v1/bookings/lookup/cancellation').send({ reference, phone });
      for (const r of [otp, cancel, preview]) {
        expect(r.status).toBe(404);
        expect(r.body).toEqual(miss.body);
      }
    }
    expect(ctx.services.sms.sent).toHaveLength(sentBefore);
    // The real code was never touched by the wrong-phone attempts.
    await lookupOtp(reference);
    const ok = await post('/api/v1/bookings/lookup/cancel', { reference, phone: PHONE, otpCode: lastCode() });
    expect(ok.status).toBe(200);
  });

  it('guest otp and cancel refuse a booking that cannot be cancelled, without spending a code', async () => {
    const reference = await guestBookingRef();
    await lookupOtp(reference);
    const code = lastCode();
    const sent = ctx.services.sms.sent.length;
    const original = (await Booking.findOne({ reference }).setOptions({ crossTenant: true }))!.startAt;
    const setStart = (startAt: Date) => Booking.updateOne({ reference }, { startAt }).setOptions({ crossTenant: true });
    await setStart(new Date(ctx.services.now().getTime() - 60_000));
    const late = await post('/api/v1/bookings/lookup/cancel', { reference, phone: PHONE, otpCode: code });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('too_late');
    expect((await lookupOtp(reference)).body.error.code).toBe('too_late');
    expect(ctx.services.sms.sent).toHaveLength(sent);
    // The code was not consumed: it still verifies once the start is back in the future.
    await setStart(original);
    const ok = await post('/api/v1/bookings/lookup/cancel', { reference, phone: PHONE, otpCode: code });
    expect(ok.status).toBe(200);

    const again = await lookupOtp(reference);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('invalid_transition');
    expect(ctx.services.sms.sent).toHaveLength(sent);
  });

  it('a player-linked booking cannot be guest-cancelled by reference and phone', async () => {
    const reference = await guestBookingRef();
    const { userId } = await newPlayer();
    await Booking.updateOne({ reference }, { playerId: userId }).setOptions({ crossTenant: true });
    const sent = ctx.services.sms.sent.length;
    expect((await lookupOtp(reference)).status).toBe(404);
    expect((await post('/api/v1/bookings/lookup/cancel', { reference, phone: PHONE, otpCode: '123456' })).status).toBe(404);
    expect(ctx.services.sms.sent).toHaveLength(sent);
    expect((await request(ctx.app).post('/api/v1/bookings/lookup').send({ reference, phone: PHONE })).status).toBe(200);
  });
});
