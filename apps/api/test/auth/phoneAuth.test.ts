import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { User } from '../../src/auth/user.model';
import { OtpCode } from '../../src/auth/otp.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), OtpCode.init()]);
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), OtpCode.deleteMany({})]);
  ctx = buildTestApp();
});

const PHONE = '+8801712345678';
const requestOtp = (phone = PHONE) =>
  request(ctx.app).post('/api/v1/auth/otp/request').send({ phone });
const verify = (code: string, phone = PHONE, extra: object = {}) =>
  request(ctx.app)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, code, ...extra });
const lastCode = () => /\d{6}/.exec(ctx.services.sms.sent.at(-1)?.text ?? '')?.[0] ?? '';

describe('phone OTP', () => {
  it('request sends a 6-digit code to the E.164 number', async () => {
    const res = await requestOtp('+880 1712-345678');
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ expiresInSec: 300, resendInSec: 60 });
    expect(ctx.services.sms.sent).toEqual([
      { to: PHONE, text: 'Your verification code is 123456. It expires in 5 minutes.' },
    ]);
  });

  it('stores only a hash of the code', async () => {
    await requestOtp();
    const doc = (await OtpCode.findOne({ phone: PHONE }).lean())!;
    expect(doc.codeHash).toMatch(/^[0-9a-f]{64}$/);
    // The phone itself happens to contain "123456", so check everything else.
    expect(JSON.stringify({ ...doc, phone: undefined })).not.toContain('123456');
  });

  it('verify creates a new user (201) then logs in the same user (200) with formatting differences', async () => {
    await requestOtp();
    const first = await verify(lastCode(), PHONE, { name: 'Ivan' });
    expect(first.status).toBe(201);
    expect(first.body.user).toMatchObject({ name: 'Ivan', phone: PHONE, email: null });
    expect(typeof first.body.accessToken).toBe('string');
    ctx.services.clock.advance(61_000);
    await requestOtp('+880 1712 345 678');
    const second = await verify(lastCode(), '+880-1712-345678');
    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it('local number without country → 400 invalid_phone', async () => {
    const res = await requestOtp('01712345678');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_phone');
    expect(ctx.services.sms.sent).toHaveLength(0);
  });

  it('second request within 60 s → 429 otp_cooldown with retryInSec', async () => {
    await requestOtp();
    ctx.services.clock.advance(20_000);
    const res = await requestOtp();
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('otp_cooldown');
    expect(res.body.error.details).toEqual({ retryInSec: 40 });
    expect(ctx.services.sms.sent).toHaveLength(1);
  });

  it('6th request in an hour → 429 otp_rate_limited', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await requestOtp()).status).toBe(202);
      ctx.services.clock.advance(61_000);
    }
    const res = await requestOtp();
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('otp_rate_limited');
  });

  it('code expires after 5 minutes → 400 otp_expired', async () => {
    await requestOtp();
    ctx.services.clock.advance(5 * 60_000 + 1_000);
    const res = await verify(lastCode());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('otp_expired');
  });

  it('5 wrong attempts kill the code even if the 6th is right', async () => {
    await requestOtp();
    for (let i = 0; i < 5; i++) {
      expect((await verify('000000')).body.error.code).toBe('otp_invalid');
    }
    const res = await verify(lastCode());
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('otp_attempts_exceeded');
  });

  it('a code is single-use', async () => {
    await requestOtp();
    const code = lastCode();
    expect((await verify(code)).status).toBe(201);
    const again = await verify(code);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('otp_invalid');
  });

  it('new request invalidates the previous code', async () => {
    const codes = ['111111', '222222'];
    ctx.services.otpCode = () => codes.shift() ?? '999999';
    await requestOtp();
    ctx.services.clock.advance(61_000);
    await requestOtp();
    expect((await verify('111111')).body.error.code).toBe('otp_invalid');
    expect((await verify('222222')).status).toBe(201);
  });

  it('verify without any requested code → 400 otp_invalid', async () => {
    const res = await verify('123456');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('otp_invalid');
  });

  it('malformed code → 400 validation_error', async () => {
    const res = await verify('12ab');
    expect(res.body.error.code).toBe('validation_error');
  });

  it('disabled phone account → 403 account_disabled', async () => {
    await User.create({ phone: PHONE, phoneVerified: true, status: 'disabled' });
    await requestOtp();
    const res = await verify(lastCode());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('account_disabled');
  });
});
