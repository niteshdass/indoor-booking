import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { connectStripe } from '../helpers/stripe';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { PaymentGatewayAccount, loadGateway } from '../../src/payments/gateway.model';
import { Payment } from '../../src/bookings/payment.model';
import { open } from '../../src/payments/secretBox';
import type { StripeCredentials } from '../../src/payments/gateway';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(),
    PaymentGatewayAccount.init(), Payment.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    Role.deleteMany({ ownerId: { $ne: null } }),
    ActivityLog.deleteMany({}).setOptions({ crossTenant: true }),
    PaymentGatewayAccount.deleteMany({}).setOptions({ crossTenant: true }),
    Payment.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
});

const api = () => request(ctx.app);
const base = (ownerId = a.ownerId) => `/api/v1/owners/${ownerId}/payment-gateways`;
const webhookUrl = (ownerId = a.ownerId) => `http://localhost:4000/api/v1/webhooks/stripe/${ownerId}`;
const valid = {
  secretKey: 'sk_test_abc123',
  publishableKey: 'pk_test_abc123',
  webhookSecret: 'whsec_abc123',
};
const put = (body: object = valid, token = a.token, ownerId = a.ownerId) =>
  api().put(`${base(ownerId)}/stripe`).set(...bearer(token)).send(body);

describe('owner gateway settings', () => {
  it('lists an unconnected gateway with nulls', async () => {
    const res = await api().get(base()).set(...bearer(a.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        gateway: 'stripe', connected: false, enabled: false, mode: null, accounts: { test: null, live: null },
        webhookUrl: webhookUrl(), webhookEvents: expect.arrayContaining(['refund.updated', 'refund.failed']), updatedAt: null,
      },
      {
        gateway: 'sslcommerz', connected: false, enabled: false, mode: null, accounts: { test: null, live: null },
        webhookUrl: `http://localhost:4000/api/v1/webhooks/sslcommerz/${a.ownerId}`, webhookEvents: [], updatedAt: null,
      },
    ]);
  });

  it('connects, keeps secrets out of the response and the log, and seals them at rest', async () => {
    const res = await put();
    expect(res.status).toBe(200);
    expect(res.body.gateway).toMatchObject({
      connected: true, enabled: true, mode: 'test',
      accounts: { test: { accountId: 'acct_test_abc123', publishableKey: 'pk_test_abc123' }, live: null },
      webhookUrl: webhookUrl(),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/sk_test_|whsec_/);

    const list = await api().get(base()).set(...bearer(a.token));
    expect(list.body[0]).toMatchObject({ connected: true, accounts: res.body.gateway.accounts });
    expect(JSON.stringify(list.body)).not.toMatch(/sk_test_|whsec_/);

    const row = (await PaymentGatewayAccount.findOne({ ownerId: a.ownerId }))!;
    expect(row.keys!.test!.credentialsEncrypted).not.toMatch(/sk_test_|whsec_/);
    expect(JSON.parse(open(row.keys!.test!.credentialsEncrypted, ctx.config.paymentsKey!, `${a.ownerId}:stripe`))).toEqual({
      secretKey: valid.secretKey, webhookSecret: valid.webhookSecret,
    });

    const logs = await ActivityLog.find({ ownerId: a.ownerId, action: 'payment_gateway.connect' }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.after).toEqual({ gateway: 'stripe', mode: 'test', enabled: true, accounts: { test: 'acct_test_abc123', live: null } });
    expect(JSON.stringify(logs[0])).not.toMatch(/sk_test_|whsec_/);
  });

  it('loadGateway decrypts, and returns null for no row, unknown key or no paymentsKey', async () => {
    expect(await loadGateway(a.ownerId, 'stripe', ctx.config, ctx.services)).toBeNull();
    await connectStripe(ctx.app, a, { enabled: false });
    const loaded = await loadGateway(a.ownerId, 'stripe', ctx.config, ctx.services);
    expect((loaded?.creds as StripeCredentials | undefined)?.secretKey).toMatch(/^sk_test_owner/);
    expect(loaded?.row.enabled).toBe(false);
    expect(loaded?.gateway.key).toBe('stripe');
    expect(await loadGateway(a.ownerId, 'paypal', ctx.config, ctx.services)).toBeNull();
    expect(await loadGateway(a.ownerId, 'stripe', { ...ctx.config, paymentsKey: undefined }, ctx.services)).toBeNull();
  });

  describe('validation', () => {
    it.each([
      ['mixed modes', { ...valid, secretKey: 'sk_live_abc123' }],
      ['bad secret key', { ...valid, secretKey: 'abc' }],
      ['bad publishable key', { ...valid, publishableKey: 'nope' }],
      ['bad webhook secret', { ...valid, webhookSecret: 'x' }],
    ])('%s → 400 validation_error', async (_n, body) => {
      const res = await put(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
      expect(JSON.stringify(res.body)).not.toContain(valid.webhookSecret);
    });

    it('rejected credentials → 400 invalid_credentials, key not echoed, nothing saved', async () => {
      ctx.services.stripe.fail('accounts.retrieve', 'auth');
      const res = await put();
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_credentials');
      expect(res.body.error.message).not.toContain(valid.secretKey);
      expect(await PaymentGatewayAccount.countDocuments({}).setOptions({ crossTenant: true })).toBe(0);
    });

    it('other Stripe failure → 502 gateway_error', async () => {
      ctx.services.stripe.fail('accounts.retrieve', 'api');
      const res = await put();
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('gateway_error');
    });

    it('unknown gateway → 404', async () => {
      const res = await api().put(`${base()}/paypal`).set(...bearer(a.token)).send(valid);
      expect(res.status).toBe(404);
    });
  });

  describe('permissions', () => {
    it('manager → 403', async () => {
      const m = await addMember(ctx.services, a.ownerId, { roleKey: 'manager' });
      expect((await put(valid, m.token)).status).toBe(403);
      expect((await api().get(base()).set(...bearer(m.token))).status).toBe(403);
    });

    it("another owner's token → same 404 as the other owner routes", async () => {
      const b = await seedOwner(ctx.services);
      const members = await api().get(`/api/v1/owners/${a.ownerId}/members`).set(...bearer(b.token));
      const res = await put(valid, b.token, a.ownerId);
      expect(res.status).toBe(members.status);
      expect(res.body).toEqual(members.body);
      expect(res.status).toBe(404);
    });
  });

  it('503 payments_unconfigured without an encryption key', async () => {
    const { app } = buildTestApp({ services: ctx.services, config: { paymentsKey: undefined } });
    const res = await request(app).put(`${base()}/stripe`).set(...bearer(a.token)).send(valid);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('payments_unconfigured');
  });

  it('PATCH toggles enabled and logs payment_gateway.update', async () => {
    await put();
    const res = await api().patch(`${base()}/stripe`).set(...bearer(a.token)).send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.gateway.enabled).toBe(false);
    const logs = await ActivityLog.find({ ownerId: a.ownerId, action: 'payment_gateway.update' }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.after).toMatchObject({ enabled: false });
  });

  it('PATCH before connecting → 404', async () => {
    const res = await api().patch(`${base()}/stripe`).set(...bearer(a.token)).send({ enabled: true });
    expect(res.status).toBe(404);
  });

  describe('switching accounts', () => {
    const pendingCard = (accountId: string) =>
      Payment.create({
        ownerId: a.ownerId,
        venueId: new mongoose.Types.ObjectId(),
        bookingId: new mongoose.Types.ObjectId(),
        method: 'card', status: 'pending', amount: 100, currency: 'BDT',
        gateway: 'stripe', gatewayAccountId: accountId, kind: 'intent',
      });

    it('fails a pending card payment that never reached Stripe and has no live hold, without a Stripe call', async () => {
      const { accountId } = await connectStripe(ctx.app, a, { secretKey: 'sk_test_first1' });
      const p = await pendingCard(accountId);
      const res = await put({ ...valid, secretKey: 'sk_test_second' });
      expect(res.status).toBe(200);
      expect((await PaymentGatewayAccount.findOne({ ownerId: a.ownerId }))!.keys!.test!.accountId).toBe('acct_test_second');
      expect(await Payment.findById(p._id).setOptions({ crossTenant: true })).toMatchObject({
        status: 'failed', failureCode: 'account_switched',
      });
      expect(ctx.services.stripe.calls.filter((c) => /cancel|expire/.test(c.method))).toHaveLength(0);
    });

    it('same account again is allowed with a pending payment', async () => {
      const { accountId } = await connectStripe(ctx.app, a, { secretKey: 'sk_test_first1' });
      await pendingCard(accountId);
      const res = await put({ ...valid, secretKey: 'sk_test_first1' });
      expect(res.status).toBe(200);
    });

    it('switches when nothing is pending', async () => {
      const first = await connectStripe(ctx.app, a, { secretKey: 'sk_test_first1' });
      const res = await put({ ...valid, secretKey: 'sk_test_second' });
      expect(res.status).toBe(200);
      expect(res.body.gateway.accounts.test.accountId).not.toBe(first.accountId);
    });
  });

  describe('test and live modes', () => {
    const live = { secretKey: 'sk_live_abc999', publishableKey: 'pk_live_abc999', webhookSecret: 'whsec_live1' };
    const patch = (body: object) => api().patch(`${base()}/stripe`).set(...bearer(a.token)).send(body);
    const pendingCard = (accountId: string, gatewayMode: string) =>
      Payment.create({
        ownerId: a.ownerId,
        venueId: new mongoose.Types.ObjectId(),
        bookingId: new mongoose.Types.ObjectId(),
        method: 'card', status: 'pending', amount: 100, currency: 'BDT',
        gateway: 'stripe', gatewayAccountId: accountId, gatewayMode, kind: 'intent',
      });

    it('keeps both modes side by side; adding live keys does not switch from test', async () => {
      await put();
      const res = await put(live);
      expect(res.status).toBe(200);
      expect(res.body.gateway).toMatchObject({
        mode: 'test',
        accounts: {
          test: { accountId: 'acct_test_abc123', publishableKey: 'pk_test_abc123' },
          live: { accountId: 'acct_test_abc999', publishableKey: 'pk_live_abc999' },
        },
      });
      expect(((await loadGateway(a.ownerId, 'stripe', ctx.config, ctx.services))?.creds as StripeCredentials | undefined)?.secretKey).toBe(valid.secretKey);
      expect(((await loadGateway(a.ownerId, 'stripe', ctx.config, ctx.services, { mode: 'live' }))?.creds as StripeCredentials | undefined)?.secretKey).toBe(live.secretKey);
    });

    it('first keys saved pick the active mode', async () => {
      expect((await put(live)).body.gateway.mode).toBe('live');
    });

    it('PATCH switches the active mode and logs it', async () => {
      await put();
      await put(live);
      const res = await patch({ mode: 'live' });
      expect(res.status).toBe(200);
      expect(res.body.gateway.mode).toBe('live');
      expect((await loadGateway(a.ownerId, 'stripe', ctx.config, ctx.services))?.mode).toBe('live');
      const logs = await ActivityLog.find({ ownerId: a.ownerId, action: 'payment_gateway.update' }).lean();
      expect(logs.at(-1)!.before).toMatchObject({ mode: 'test' });
      expect(logs.at(-1)!.after).toMatchObject({ mode: 'live' });
    });

    it('PATCH to a mode without keys → 400', async () => {
      await put();
      const res = await patch({ mode: 'live' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('gateway_mode_not_connected');
    });

    it('PATCH with nothing to change → 400', async () => {
      await put();
      expect((await patch({})).status).toBe(400);
    });

    it('switching mode fails the old mode\'s pending payments but leaves the other mode\'s alone', async () => {
      await put();
      await put(live);
      const testPending = await pendingCard('acct_test_abc123', 'test');
      const res = await patch({ mode: 'live' });
      expect(res.status).toBe(200);
      expect(await Payment.findById(testPending._id).setOptions({ crossTenant: true })).toMatchObject({
        status: 'failed', failureCode: 'account_switched',
      });
      const livePending = await pendingCard('acct_test_abc999', 'live');
      await put({ ...valid, secretKey: 'sk_test_other1' });
      expect((await Payment.findById(livePending._id).setOptions({ crossTenant: true }))!.status).toBe('pending');
    });
  });
});
