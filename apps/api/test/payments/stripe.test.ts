import { describe, it, expect, beforeEach } from 'vitest';
import { stripeGateway } from '../../src/payments/stripe';
import { GatewayError, gatewayFor } from '../../src/payments/gateway';
import { makeTestServices, type TestServices } from '../helpers/testServices';
import { signedEvent } from '../helpers/stripe';

const creds = { secretKey: 'sk_test_abcdef123456', webhookSecret: 'whsec_test_secret' };
const meta = { paymentId: 'p1', bookingId: 'b1', ownerId: 'o1', reference: 'BK-1' };

let services: TestServices;
let gw: ReturnType<typeof stripeGateway>;
beforeEach(() => {
  services = makeTestServices();
  gw = stripeGateway(services.stripe);
});

describe('gatewayFor', () => {
  it('resolves stripe only', () => {
    expect(gatewayFor(services, 'stripe')?.key).toBe('stripe');
    expect(gatewayFor(services, 'paypal')).toBeNull();
  });
});

describe('supports', () => {
  it('accepts 0 and 2 decimal currencies, rejects 3-decimal and unknown', () => {
    expect(gw.supports('BD', 'BDT')).toBe(true);
    expect(gw.supports('JP', 'JPY')).toBe(true);
    expect(gw.supports('US', 'USD')).toBe(true);
    expect(gw.supports('KW', 'KWD')).toBe(false);
    expect(gw.supports('US', 'XXX')).toBe(false);
  });
});

describe('createPayment', () => {
  it('creates a PaymentIntent for kind intent', async () => {
    const r = await gw.createPayment(creds, {
      kind: 'intent', amount: 1005, currency: 'JPY', metadata: meta, description: 'Booking BK-1', idempotencyKey: 'intent_p1',
    });
    expect(services.stripe.calls).toHaveLength(1);
    const c = services.stripe.calls[0]!;
    expect(c.method).toBe('paymentIntents.create');
    expect(c.secretKey).toBe(creds.secretKey);
    expect(c.idempotencyKey).toBe('intent_p1');
    expect(c.params).toMatchObject({
      amount: 1005, currency: 'jpy', automatic_payment_methods: { enabled: true }, metadata: meta, description: 'Booking BK-1',
    });
    expect(r).toEqual({ gatewayRef: 'pi_test_1', clientSecret: 'pi_test_1_secret_x', linkRef: null, url: null });
  });

  it('creates a Checkout Session for kind link', async () => {
    const expiresAt = new Date('2026-01-01T00:32:00Z');
    const r = await gw.createPayment(creds, {
      kind: 'link', amount: 500, currency: 'USD', metadata: meta, description: 'Booking BK-1',
      idempotencyKey: 'link_p1', expiresAt, successUrl: 'https://app.test/payment-complete?reference=BK-1',
    });
    const c = services.stripe.calls[0]!;
    expect(c.method).toBe('checkout.sessions.create');
    expect(c.idempotencyKey).toBe('link_p1');
    expect(c.params).toMatchObject({
      mode: 'payment',
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      success_url: 'https://app.test/payment-complete?reference=BK-1',
      metadata: meta,
      payment_intent_data: { metadata: meta },
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: 500 } }],
    });
    expect(r).toEqual({ gatewayRef: null, linkRef: 'cs_test_1', clientSecret: null, url: 'https://checkout.stripe.test/cs_test_1' });
  });

  it('a session expiring under 30 minutes after Stripe receives it is a gateway error', async () => {
    const link = {
      kind: 'link' as const, amount: 500, currency: 'USD', metadata: meta, description: 'Booking BK-1',
      expiresAt: new Date('2026-01-01T00:30:00Z'),
    };
    await expect(gw.createPayment(creds, { ...link, idempotencyKey: 'link_short' })).rejects.toMatchObject({ code: 'gateway_error' });
    services.clock.advance(-60_000);
    await expect(gw.createPayment(creds, { ...link, idempotencyKey: 'link_ok' })).resolves.toMatchObject({ linkRef: 'cs_test_1' });
  });

  it('replays the same result for a repeated idempotency key', async () => {
    const input = { kind: 'intent' as const, amount: 100, currency: 'USD', metadata: meta, description: 'd', idempotencyKey: 'k' };
    const a = await gw.createPayment(creds, input);
    const b = await gw.createPayment(creds, input);
    expect(b).toEqual(a);
  });

  it('wraps Stripe failures in a fixed-message GatewayError', async () => {
    services.stripe.fail('paymentIntents.create', 'api');
    const err = await gw
      .createPayment(creds, { kind: 'intent', amount: 100, currency: 'USD', metadata: meta, description: 'd', idempotencyKey: 'k' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe('gateway_error');
    expect(err.message).not.toContain('fake stripe failure');
  });
});

describe('handleWebhook', () => {
  const evt = (type: string, object: object) => ({ id: `evt_${type}`, object: 'event', type, data: { object } });

  it('maps the four handled types', () => {
    const cases: [object, object][] = [
      [
        evt('payment_intent.succeeded', { id: 'pi_1', amount: 1000, amount_received: 900, currency: 'usd', metadata: meta }),
        { kind: 'succeeded', paymentId: 'p1', gatewayRef: 'pi_1', amount: 900, currency: 'USD' },
      ],
      [
        evt('payment_intent.payment_failed', { id: 'pi_1', metadata: meta, last_payment_error: { code: 'card_declined' } }),
        { kind: 'attempt_failed', paymentId: 'p1', failureCode: 'card_declined' },
      ],
      [evt('payment_intent.canceled', { id: 'pi_1', metadata: meta }), { kind: 'closed', paymentId: 'p1' }],
      [evt('checkout.session.expired', { id: 'cs_1', metadata: meta }), { kind: 'closed', paymentId: 'p1' }],
    ];
    for (const [event, expected] of cases) {
      const { body, signature } = signedEvent(creds.webhookSecret, event);
      expect(gw.handleWebhook(creds, Buffer.from(body), signature)).toMatchObject({
        id: (event as { id: string }).id, type: (event as { type: string }).type, ...expected,
      });
    }
  });

  it('gives null paymentId / failureCode when absent', () => {
    const { body, signature } = signedEvent(creds.webhookSecret, evt('payment_intent.payment_failed', { id: 'pi_1', metadata: {} }));
    expect(gw.handleWebhook(creds, Buffer.from(body), signature)).toMatchObject({
      kind: 'attempt_failed', paymentId: null, failureCode: null,
    });
  });

  it('ignores other types', () => {
    const { body, signature } = signedEvent(creds.webhookSecret, evt('customer.created', { id: 'cus_1' }));
    expect(gw.handleWebhook(creds, Buffer.from(body), signature)).toMatchObject({ kind: 'ignored', type: 'customer.created' });
  });

  it('rejects tampered body, wrong secret, missing signature', () => {
    const { body, signature } = signedEvent(creds.webhookSecret, evt('customer.created', { id: 'cus_1' }));
    const wrong = signedEvent('whsec_other', evt('customer.created', { id: 'cus_1' }));
    const attempts: [Buffer, string | undefined][] = [
      [Buffer.from(body + ' '), signature],
      [Buffer.from(wrong.body), wrong.signature],
      [Buffer.from(body), undefined],
    ];
    for (const [b, s] of attempts) {
      try {
        gw.handleWebhook(creds, b, s);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(GatewayError);
        expect((e as GatewayError).code).toBe('invalid_signature');
      }
    }
  });
});

describe('refund', () => {
  it.each(['succeeded', 'pending', 'failed'] as const)('maps %s', async (status) => {
    const real = services.stripe(creds.secretKey);
    const spy = { ...real, refunds: { create: async () => ({ id: 're_x', status }) } };
    const g = stripeGateway(() => spy);
    expect(await g.refund(creds, { gatewayRef: 'pi_1', amount: 50, idempotencyKey: 'refund_p1' })).toEqual({ refundRef: 're_x', status });
  });

  it('passes payment_intent, amount and idempotency key through', async () => {
    const r = await gw.refund(creds, { gatewayRef: 'pi_1', amount: 50, idempotencyKey: 'refund_p1' });
    expect(r).toEqual({ refundRef: 're_test_1', status: 'succeeded' });
    const c = services.stripe.calls[0]!;
    expect(c).toMatchObject({ method: 'refunds.create', idempotencyKey: 'refund_p1', params: { payment_intent: 'pi_1', amount: 50 } });
  });
});

describe('verifyCredentials', () => {
  it('returns the account id', async () => {
    expect(await gw.verifyCredentials(creds)).toEqual({ accountId: 'acct_test_123456' });
  });

  it('maps auth failure to invalid_credentials and others to gateway_error, without leaking the key', async () => {
    services.stripe.fail('accounts.retrieve', 'auth');
    const a = await gw.verifyCredentials(creds).catch((e) => e);
    expect(a).toBeInstanceOf(GatewayError);
    expect(a.code).toBe('invalid_credentials');
    services.stripe.fail('accounts.retrieve', 'api');
    const b = await gw.verifyCredentials(creds).catch((e) => e);
    expect(b.code).toBe('gateway_error');
    for (const e of [a, b]) expect(e.message).not.toContain(creds.secretKey);
  });
});
