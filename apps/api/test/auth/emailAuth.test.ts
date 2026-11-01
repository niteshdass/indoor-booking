import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { User } from '../../src/auth/user.model';
import { RefreshToken } from '../../src/auth/refreshToken.model';
import { refreshCookie } from '../helpers/refreshCookie';
import { PasswordReset } from '../../src/auth/passwordReset.model';
import { OtpCode } from '../../src/auth/otp.model';
import { OtpThrottle } from '../../src/auth/otpThrottle.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), RefreshToken.init(), PasswordReset.init(), OtpCode.init(), OtpThrottle.init()]);
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    RefreshToken.deleteMany({}),
    PasswordReset.deleteMany({}),
    OtpCode.deleteMany({}),
    OtpThrottle.deleteMany({}),
  ]);
  ctx = buildTestApp();
});

const PHONE = '+8801712345678';
const body = { name: 'Ana', email: 'ana@x.com', password: 'secret123', phone: PHONE, code: '123456' };
const requestCode = (phone = PHONE) => request(ctx.app).post('/api/v1/auth/register/otp/request').send({ phone });
const postRegister = (b: object) => request(ctx.app).post('/api/v1/auth/register').send(b);
/** Sends the phone code first, as the register page does. */
const register = async (b: { phone?: string } & Record<string, unknown>) => {
  await requestCode(b.phone ?? PHONE);
  return postRegister(b);
};
const login = (b: object) => request(ctx.app).post('/api/v1/auth/login').send(b);
const forgot = (email: string) =>
  request(ctx.app).post('/api/v1/auth/password/forgot').send({ email });
const reset = (token: string, password: string) =>
  request(ctx.app).post('/api/v1/auth/password/reset').send({ token, password });
const resetTokenFromEmail = () => {
  const text = ctx.services.email.sent.at(-1)?.text ?? '';
  return /reset-password\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';
};

describe('register', () => {
  it('verifies the phone, registers and returns tokens', async () => {
    const sent = await requestCode();
    expect(sent.status).toBe(202);
    expect(ctx.services.sms.sent.at(-1)).toMatchObject({ to: PHONE });
    const res = await postRegister({ ...body, email: ' Ana@X.com ', phone: '+880 1712-345678' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      name: 'Ana',
      email: 'ana@x.com',
      hasPassword: true,
      emailVerified: false,
      phone: PHONE,
      hasGoogle: false,
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.refreshToken).toBeUndefined();
    expect(typeof refreshCookie(res)).toBe('string');
    expect((await User.findOne({ email: 'ana@x.com' }))?.phoneVerified).toBe(true);
  });
  it('no phone or code → 400 validation_error', async () => {
    const res = await postRegister({ name: 'Ana', email: 'ana@x.com', password: 'secret123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
  it('wrong code → 400 otp_invalid, no account', async () => {
    await requestCode();
    const res = await postRegister({ ...body, code: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('otp_invalid');
    expect(await User.countDocuments()).toBe(0);
  });
  it('a code sent for sign-in does not register', async () => {
    await request(ctx.app).post('/api/v1/auth/otp/request').send({ phone: PHONE });
    const res = await postRegister(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('otp_invalid');
  });
  it('code for a number that has an account → 409 phone_in_use, no SMS', async () => {
    await User.create({ phone: PHONE, phoneVerified: true });
    const res = await requestCode();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('phone_in_use');
    expect(ctx.services.sms.sent).toHaveLength(0);
  });
  it('same email in different case → 409 email_in_use, and the code is still usable', async () => {
    await register(body);
    const other = '+8801812345678';
    await requestCode(other);
    const taken = await postRegister({ ...body, email: 'ANA@x.com', phone: other });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('email_in_use');
    const fixed = await postRegister({ ...body, email: 'bo@x.com', phone: other });
    expect(fixed.status).toBe(201);
  });
  it('concurrent duplicate registrations → one 201, the other refused', async () => {
    await requestCode();
    const [a, b] = await Promise.all([postRegister(body), postRegister(body)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(201);
    expect([400, 409]).toContain(statuses[1]);
    expect(await User.countDocuments()).toBe(1);
  });
  it('short password → 400 validation_error', async () => {
    const res = await register({ ...body, password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
  it('invalid email → 400 invalid_email', async () => {
    const res = await register({ ...body, email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_email');
  });
});

describe('login', () => {
  it('login works with any email casing', async () => {
    const reg = await register(body);
    const res = await login({ email: '  ANA@X.COM', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(reg.body.user.id);
  });
  it('wrong password and unknown email give identical 401 invalid_credentials', async () => {
    await register(body);
    const a = await login({ email: 'ana@x.com', password: 'nope1234' });
    const b = await login({ email: 'ghost@x.com', password: 'nope1234' });
    expect(a.status).toBe(401);
    expect(a.body.error.code).toBe('invalid_credentials');
    expect(a.body).toEqual(b.body);
  });
  it('account without a password (e.g. phone-only) → 401 invalid_credentials', async () => {
    await User.create({ email: 'nopw@x.com' });
    const res = await login({ email: 'nopw@x.com', password: 'whatever1' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });
  it('disabled account with right password → 403 account_disabled', async () => {
    await register(body);
    await User.updateOne({ email: 'ana@x.com' }, { status: 'disabled' });
    const res = await login({ email: 'ana@x.com', password: 'secret123' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('account_disabled');
  });
});

describe('password reset', () => {
  it('forgot → email with link; reset changes password, old refresh tokens die, token single-use', async () => {
    const reg = await register(body);
    expect((await forgot('Ana@X.com')).status).toBe(202);
    expect(ctx.services.email.sent).toHaveLength(1);
    expect(ctx.services.email.sent[0]?.to).toBe('ana@x.com');
    expect(ctx.services.email.sent[0]?.text).toContain(
      'http://localhost:5173/reset-password?token=',
    );
    const token = resetTokenFromEmail();
    expect((await reset(token, 'newsecret1')).status).toBe(204);
    expect((await login({ email: 'ana@x.com', password: 'secret123' })).status).toBe(401);
    expect((await login({ email: 'ana@x.com', password: 'newsecret1' })).status).toBe(200);
    const old = await request(ctx.app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `rt=${refreshCookie(reg)}`);
    expect(old.status).toBe(401);
    const again = await reset(token, 'another12');
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('invalid_reset_token');
  });
  it('forgot for unknown email → 202 and no email', async () => {
    const res = await forgot('ghost@x.com');
    expect(res.status).toBe(202);
    expect(ctx.services.email.sent).toHaveLength(0);
  });
  it('reset token older than 1 hour → 400 invalid_reset_token', async () => {
    await register(body);
    await forgot('ana@x.com');
    ctx.services.clock.advance(61 * 60_000);
    const res = await reset(resetTokenFromEmail(), 'newsecret1');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_reset_token');
  });
  it('unknown reset token → 400 invalid_reset_token', async () => {
    const res = await reset('nope', 'newsecret1');
    expect(res.body.error.code).toBe('invalid_reset_token');
  });
});

describe('rate limit', () => {
  it('rate limit → 429 rate_limited after 20 requests', async () => {
    const limited = buildTestApp({ rateLimit: true });
    for (let i = 0; i < 20; i++) {
      expect((await request(limited.app).post('/api/v1/auth/login').send({})).status).toBe(400);
    }
    const res = await request(limited.app).post('/api/v1/auth/login').send({});
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('rate_limited');
  });
});
