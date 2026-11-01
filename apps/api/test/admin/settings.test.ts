import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp, testConfig } from '../helpers/testApp';
import { bearer, seedUser } from '../helpers/tenancy';
import { User } from '../../src/auth/user.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { PlatformLog } from '../../src/admin/platformLog.model';
import { defaultServices, defaultSmsSender } from '../../src/services';
import { SPORTS } from '@booking/shared';
import { PlatformSettings, clearSettingsCache, resolveEmail, resolveGeneral, resolveGoogleClientId, resolvePayoutStripe, resolveSms, resolveSmsBd } from '../../src/admin/settings';

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
    expect(s.body.sms).toMatchObject({ source: 'admin', twilio: { accountSid: SID, from: twilio.from, authTokenSet: true } });
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
    expect(res.body.sms).toMatchObject({ source: 'server', twilio: null });
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

describe('Bangladesh SMS provider', () => {
  const bd = { provider: 'ssl_wireless', apiKey: 'bd-key-1', senderId: 'TURFBOOK' };
  const del = (path: string) => request(ctx.app).delete(api(path)).set(...bearer(admin.token));

  it('seals the API key, keeps it on a blank save, and needs a new one for a new provider', async () => {
    const res = await put('/admin/settings/sms-bd', bd);
    expect(res.status).toBe(200);
    expect(res.body.sms.bd).toEqual({ source: 'admin', provider: 'ssl_wireless', senderId: 'TURFBOOK', apiKeySet: true });
    expect(JSON.stringify(await PlatformSettings.findById('platform').lean())).not.toContain('bd-key-1');
    expect(await resolveSmsBd(testConfig)).toEqual({ provider: 'ssl_wireless', apiKey: 'bd-key-1', senderId: 'TURFBOOK' });

    expect((await put('/admin/settings/sms-bd', { ...bd, apiKey: '', senderId: 'OTHER' })).status).toBe(200);
    expect(await resolveSmsBd(testConfig)).toMatchObject({ apiKey: 'bd-key-1', senderId: 'OTHER' });
    expect((await put('/admin/settings/sms-bd', { ...bd, provider: 'bulksmsbd', apiKey: '' })).body.error.code).toBe('secret_required');
    expect((await put('/admin/settings/sms-bd', { ...bd, provider: 'other' })).status).toBe(400);
    expect((await put('/admin/settings/sms-bd', { ...bd, senderId: 'bad;id' })).status).toBe(400);

    expect((await del('/admin/settings/sms-bd')).body.sms.bd).toEqual({ source: 'none', provider: null, senderId: null, apiKeySet: false });
    expect(await resolveSmsBd(testConfig)).toBeNull();
  });

  it('reports a provider from the server env', async () => {
    ctx = buildTestApp({ config: { smsBd: { provider: 'bulksmsbd', apiKey: 'k', senderId: '8809' } } });
    expect((await get('/admin/settings')).body.sms).toMatchObject({ bd: { source: 'server', apiKeySet: false }, metered: false });
  });

  it('turns metering on and off, and logs it', async () => {
    expect((await put('/admin/settings/sms-metering', { metered: 'yes' })).status).toBe(400);
    expect((await put('/admin/settings/sms-metering', { metered: true })).body.sms.metered).toBe(true);
    expect((await put('/admin/settings/sms-metering', { metered: false })).body.sms.metered).toBe(false);
    const log = await PlatformLog.find({ action: /^settings\.sms_metering/ }).sort({ _id: 1 }).lean();
    expect(log.map((l) => l.action)).toEqual(['settings.sms_metering_on', 'settings.sms_metering_off']);
  });

  it('sends Bangladeshi mobiles by the BD provider and the rest by Twilio', async () => {
    await put('/admin/settings/sms', twilio);
    const ok = () => new Response(JSON.stringify({ status: 'SUCCESS', status_code: 200, sid: 'SM1' }), { status: 200 });
    const fetchFn = vi.fn(async () => ok());
    const sender = defaultSmsSender(testConfig, fetchFn as unknown as typeof fetch);
    const hosts = () => fetchFn.mock.calls.map((c) => new URL((c as unknown as [string])[0]).host);

    // No BD provider yet: Twilio carries everything.
    await sender.send('+8801712345678', 'a');
    await put('/admin/settings/sms-bd', bd);
    await sender.send('+8801712345678', 'b');
    await sender.send('+15552223333', 'c');
    expect(hosts()).toEqual(['api.twilio.com', 'smsplus.sslwireless.com', 'api.twilio.com']);
  });
});

describe('admin general settings', () => {
  const fee = (o: object) => ({ mode: 'percent', percent: 5, fixed: null, payer: 'player', ...o });
  const general = (o: object = {}) => ({ ownerApproval: 'automatic', fee: fee({}), payout: { bkash: null, nagad: null }, ...o });

  it('general starts at defaults', async () => {
    const res = await get('/admin/settings');
    expect(res.body.general).toMatchObject({
      ownerApproval: 'manual',
      fee: { mode: 'free', fixed: null, percent: null, payer: 'owner' },
      payout: { bkash: null, nagad: null, stripe: null },
      payoutWebhookUrl: `${testConfig.apiUrl}/api/v1/webhooks/stripe/platform`,
    });
  });

  it('saves approval, fee and wallets', async () => {
    const input = { provider: 'bkash', number: '01711111111', accountType: 'personal' };
    // The number is normalized the way owner wallets are.
    const bkash = { ...input, number: '+8801711111111' };
    const res = await put('/admin/settings/general', general({ payout: { bkash: input, nagad: null } }));
    expect(res.status).toBe(200);
    expect(res.body.general).toMatchObject({
      ownerApproval: 'automatic',
      fee: { mode: 'percent', percent: 5, fixed: null, payer: 'player' },
      payout: { bkash, nagad: null, stripe: null },
    });
    clearSettingsCache();
    expect(await resolveGeneral(testConfig)).toEqual({
      ownerApproval: 'automatic',
      fee: { mode: 'percent', percent: 5, fixed: null, payer: 'player' },
      payout: { bkash, nagad: null, stripe: null },
    });
  });

  it('rejects bad fees and wallets', async () => {
    const bad = [
      fee({ percent: 60 }),
      fee({ percent: 0 }),
      fee({ percent: 1.234 }),
      fee({ mode: 'fixed', percent: null, fixed: null }),
      fee({ mode: 'fixed', percent: null, fixed: -1 }),
      fee({ mode: 'free', percent: null, fixed: 10 }),
    ];
    for (const f of bad) expect((await put('/admin/settings/general', general({ fee: f }))).status).toBe(400);
    const wrongProvider = { provider: 'nagad', number: '01711111111', accountType: 'personal' };
    expect((await put('/admin/settings/general', general({ payout: { bkash: wrongProvider, nagad: null } }))).status).toBe(400);
    const badNumber = { provider: 'bkash', number: '123', accountType: 'personal' };
    expect((await put('/admin/settings/general', general({ payout: { bkash: badNumber, nagad: null } }))).status).toBe(400);
  });

  it('saves payout stripe keys, never returns secrets, and keeps them across general saves', async () => {
    const keys = { mode: 'test', secretKey: 'sk_test_payout1', publishableKey: 'pk_test_payout1', webhookSecret: 'whsec_payout1', enabled: true };
    const res = await put('/admin/settings/payout-stripe', keys);
    expect(res.status).toBe(200);
    expect(res.body.general.payout.stripe.mode).toBe('test');
    expect(res.body.general.payout.stripe.enabled).toBe(true);
    expect(res.body.general.payout.stripe.keys.test.publishableKey).toBe('pk_test_payout1');
    expect(res.body.general.payout.stripe.keys.live).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/secretKey|sk_test_payout1|whsec_payout1/);
    expect(JSON.stringify(await PlatformSettings.findById('platform').lean())).not.toMatch(/sk_test_payout1|whsec_payout1/);

    await put('/admin/settings/general', general());
    clearSettingsCache();
    const open = (await resolveGeneral(ctx.config)).payout.stripe;
    expect(open).toMatchObject({ mode: 'test', publishableKey: 'pk_test_payout1' });
    expect(JSON.stringify(open)).not.toMatch(/sk_test_payout1|creds/);
    expect(await resolvePayoutStripe(ctx.config)).toMatchObject({
      mode: 'test',
      publishableKey: 'pk_test_payout1',
      creds: { secretKey: 'sk_test_payout1', webhookSecret: 'whsec_payout1' },
    });

    // A corrupt sealed secret cannot break resolveGeneral (it opens nothing); only the secret read fails.
    const stored = (await PlatformSettings.findById('platform').lean()) as unknown as {
      general: { payout: { stripe: { keys: { test: { credentialsEncrypted: string } } } } };
    };
    await PlatformSettings.updateOne({ _id: 'platform' }, { $set: { 'general.payout.stripe.keys.test.credentialsEncrypted': 'garbage' } });
    clearSettingsCache();
    expect((await resolveGeneral(ctx.config)).payout.stripe).toMatchObject({ mode: 'test' });
    expect(await resolvePayoutStripe(ctx.config)).toBeNull();
    await PlatformSettings.updateOne({ _id: 'platform' }, { $set: { 'general.payout.stripe.keys.test.credentialsEncrypted': stored.general.payout.stripe.keys.test.credentialsEncrypted } });
    clearSettingsCache();

    expect((await put('/admin/settings/payout-stripe', { ...keys, mode: 'live' })).status).toBe(400);
    expect((await put('/admin/settings/payout-stripe', { ...keys, publishableKey: 'pk_live_x' })).status).toBe(400);
    const off = await put('/admin/settings/payout-stripe', { ...keys, enabled: false });
    expect(off.body.general.payout.stripe.enabled).toBe(false);
    clearSettingsCache();
    expect((await resolveGeneral(ctx.config)).payout.stripe).toBeNull();

    const del = await request(ctx.app).delete(api('/admin/settings/payout-stripe')).set(...bearer(admin.token));
    expect(del.body.general.payout.stripe).toBeNull();
  });

  it('logs each save', async () => {
    await PlatformLog.deleteMany({});
    await put('/admin/settings/general', general());
    expect(await PlatformLog.countDocuments({ action: 'settings.general_updated' })).toBe(1);
  });

  it('general needs platform.settings', async () => {
    const player = await seedUser(ctx.services, { name: 'Player' });
    expect((await put('/admin/settings/general', general(), player.token)).status).toBe(403);
    expect((await put('/admin/settings/payout-stripe', {}, player.token)).status).toBe(403);
  });
});

describe('admin sports catalog', () => {
  const all = (over: Record<string, boolean> = {}, first?: string) => {
    const order = first ? [first, ...SPORTS.filter((s) => s !== first)] : [...SPORTS];
    return { sports: order.map((sport) => ({ sport, enabled: over[sport] ?? true })) };
  };

  it('starts with every sport on, in catalog order', async () => {
    const res = await get('/admin/settings');
    expect(res.body.sports).toEqual(SPORTS.map((sport) => ({ sport, enabled: true })));
    expect((await request(ctx.app).get(api('/sports'))).body).toEqual({ sports: [...SPORTS] });
  });

  it('saves order and switches; the public list shows only enabled sports in that order', async () => {
    const res = await put('/admin/settings/sports', all({ padel: false }, 'cricket'));
    expect(res.status).toBe(200);
    expect(res.body.sports[0]).toEqual({ sport: 'cricket', enabled: true });
    expect(res.body.sports.find((s: { sport: string }) => s.sport === 'padel').enabled).toBe(false);
    const pub = await request(ctx.app).get(api('/sports'));
    expect(pub.body.sports[0]).toBe('cricket');
    expect(pub.body.sports).not.toContain('padel');
    expect(pub.body.sports).toHaveLength(SPORTS.length - 1);
  });

  it('needs every sport exactly once, and at least one on', async () => {
    const { sports } = all();
    const none = all(Object.fromEntries(SPORTS.map((x) => [x, false])));
    expect((await put('/admin/settings/sports', none)).status).toBe(400);
    for (const bad of [sports.slice(1), [...sports.slice(1), sports[1]], [...sports.slice(1), { sport: 'curling', enabled: true }]]) {
      expect((await put('/admin/settings/sports', { sports: bad })).status).toBe(400);
    }
  });

  it('logs each save and needs platform.settings', async () => {
    await PlatformLog.deleteMany({});
    await put('/admin/settings/sports', all());
    expect(await PlatformLog.countDocuments({ action: 'settings.sports_updated' })).toBe(1);
    const player = await seedUser(ctx.services, { name: 'Player' });
    expect((await put('/admin/settings/sports', all(), player.token)).status).toBe(403);
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
