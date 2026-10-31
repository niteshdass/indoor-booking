import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp, testConfig } from '../helpers/testApp';
import { bearer, seedUser } from '../helpers/tenancy';
import { User } from '../../src/auth/user.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { defaultServices } from '../../src/services';
import { PlatformSettings, clearSettingsCache, resolveEmail, resolveGoogleClientId, resolveSms } from '../../src/admin/settings';

const CLIENT_ID = '1234-abc.apps.googleusercontent.com';
const SID = 'AC' + 'a'.repeat(32);
const smtp = { host: 'smtp.example.com', port: 587, secure: false, user: 'mailer', password: 'pw-1', from: 'Slots <no-reply@example.com>' };
const twilio = { accountSid: SID, authToken: 'tok-1', from: '+15550001111' };

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Role.init(), PlatformSettings.init()]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let admin: Awaited<ReturnType<typeof seedUser>>;

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), PlatformSettings.deleteMany({})]);
  clearSettingsCache();
  ctx = buildTestApp();
  admin = await seedUser(ctx.services, { name: 'Admin', platformAdmin: true });
});

const api = (path: string) => `/api/v1${path}`;
const get = (path: string, token = admin.token) => request(ctx.app).get(api(path)).set(...bearer(token));
const put = (path: string, body: object, token = admin.token) => request(ctx.app).put(api(path)).set(...bearer(token)).send(body);
const post = (path: string, body: object) => request(ctx.app).post(api(path)).set(...bearer(admin.token)).send(body);

describe('admin settings', () => {
  it('needs a platform role', async () => {
    const player = await seedUser(ctx.services, { name: 'Player' });
    expect((await get('/admin/settings', player.token)).status).toBe(403);
  });

  it('starts empty and reports the server fallback', async () => {
    ctx = buildTestApp({ config: { googleClientId: 'env.apps.googleusercontent.com' } });
    const res = await get('/admin/settings');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      google: { source: 'server', clientId: 'env.apps.googleusercontent.com' },
      email: { source: 'none', smtp: null },
      sms: { source: 'none', twilio: null },
      secretsAvailable: true,
    });
  });

  it('saves the Google client ID, which the login page and sign-in then use', async () => {
    expect((await put('/admin/settings/google', { clientId: 'nope' })).status).toBe(400);
    const res = await put('/admin/settings/google', { clientId: CLIENT_ID });
    expect(res.body.google).toEqual({ source: 'admin', clientId: CLIENT_ID });
    expect(res.body.updatedBy).toBe('Admin');
    expect((await request(ctx.app).get(api('/auth/providers'))).body).toEqual({ googleClientId: CLIENT_ID });
    expect(await resolveGoogleClientId(testConfig)).toBe(CLIENT_ID);
  });

  it('seals SMTP and Twilio secrets and never returns them', async () => {
    const e = await put('/admin/settings/email', smtp);
    expect(e.status).toBe(200);
    expect(e.body.email).toEqual({
      source: 'admin',
      smtp: { host: smtp.host, port: 587, secure: false, user: 'mailer', from: smtp.from, passwordSet: true },
    });
    const s = await put('/admin/settings/sms', twilio);
    expect(s.body.sms).toEqual({ source: 'admin', twilio: { accountSid: SID, from: twilio.from, authTokenSet: true } });
    expect(JSON.stringify(s.body)).not.toMatch(/pw-1|tok-1/);

    const doc = await PlatformSettings.findById('platform').lean();
    expect(JSON.stringify(doc)).not.toMatch(/pw-1|tok-1/);
    expect(await resolveEmail(testConfig)).toEqual({ from: smtp.from, smtp: { host: smtp.host, port: 587, secure: false, user: 'mailer', password: 'pw-1' } });
    expect(await resolveSms(testConfig)).toEqual(twilio);
  });

  it('a blank secret keeps the saved one; a new login needs a new one', async () => {
    await put('/admin/settings/email', smtp);
    await put('/admin/settings/sms', twilio);
    expect((await put('/admin/settings/email', { ...smtp, password: '', port: 465, secure: true })).status).toBe(200);
    expect((await resolveEmail(testConfig)) as unknown).toMatchObject({ smtp: { port: 465, password: 'pw-1' } });
    expect((await put('/admin/settings/email', { ...smtp, user: 'other', password: '' })).body.error.code).toBe('secret_required');
    expect((await put('/admin/settings/sms', { ...twilio, authToken: '' })).status).toBe(200);
    expect((await put('/admin/settings/sms', { ...twilio, accountSid: 'AC' + 'b'.repeat(32), authToken: '' })).status).toBe(400);
  });

  it('removing a section falls back to the server env', async () => {
    ctx = buildTestApp({ config: { sms: { accountSid: 'ACenv', authToken: 'envtok', from: '+15550002222' } } });
    await put('/admin/settings/sms', twilio);
    const res = await request(ctx.app).delete(api('/admin/settings/sms')).set(...bearer(admin.token));
    expect(res.body.sms).toEqual({ source: 'server', twilio: null });
    expect(await resolveSms(ctx.config)).toEqual({ accountSid: 'ACenv', authToken: 'envtok', from: '+15550002222' });
  });

  it('refuses secrets without an encryption key', async () => {
    ctx = buildTestApp({ config: { paymentsKey: undefined } });
    expect((await put('/admin/settings/sms', twilio)).body.error.code).toBe('payments_unconfigured');
    expect((await get('/admin/settings')).body.secretsAvailable).toBe(false);
  });

  it('sends test messages through the live senders', async () => {
    expect((await post('/admin/settings/email/test', { to: 'ops@example.com' })).status).toBe(204);
    expect(ctx.services.email.sent[0]).toMatchObject({ to: 'ops@example.com' });
    expect((await post('/admin/settings/sms/test', { to: '+8801712345678' })).status).toBe(204);
    expect(ctx.services.sms.sent[0]).toMatchObject({ to: '+8801712345678' });
    ctx.services.sms.send = async () => {
      throw new Error('Twilio 401: Authenticate');
    };
    const failed = await post('/admin/settings/sms/test', { to: '+8801712345678' });
    expect(failed.status).toBe(502);
    expect(failed.body.error).toMatchObject({ code: 'delivery_failed', message: 'Twilio 401: Authenticate' });
  });
});

describe('defaultServices', () => {
  it('prints to the console in development when nothing is configured', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await defaultServices(testConfig).sms.send('+8801712345678', 'hi');
    expect(log).toHaveBeenCalledWith('[sms] to=+8801712345678: hi');
    log.mockRestore();
  });

  it('refuses to send in production when nothing is configured', async () => {
    await expect(defaultServices({ ...testConfig, nodeEnv: 'production' }).email.send({ to: 'a@b.c', subject: 's', text: 't' })).rejects.toMatchObject({
      status: 503,
      code: 'delivery_unconfigured',
    });
  });

  it('sends through the Twilio account an admin saved, without a restart', async () => {
    const services = defaultServices(testConfig);
    await put('/admin/settings/sms', twilio);
    const fetchFn = vi.fn(async () => new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchFn);
    await services.sms.send('+8801712345678', 'hi');
    vi.unstubAllGlobals();
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain(`/Accounts/${SID}/Messages.json`);
  });
});
