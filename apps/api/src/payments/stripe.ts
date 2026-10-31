import Stripe from 'stripe';
import { currencyExponent } from '@booking/shared';
import { GatewayError, type GatewayEvent, type GatewayRefund, type PaymentGateway } from './gateway';

/** The slice of the Stripe SDK we use, so tests can inject a fake. */
export type StripeApi = {
  accounts: { retrieve(): Promise<{ id: string }> };
  paymentIntents: {
    create(p: object, o: { idempotencyKey: string }): Promise<{ id: string; client_secret: string | null }>;
    cancel(id: string): Promise<{ id: string; status: string }>;
  };
  checkout: {
    sessions: {
      create(p: object, o: { idempotencyKey: string }): Promise<{ id: string; url: string | null }>;
      expire(id: string): Promise<{ id: string; status: string | null }>;
    };
  };
  refunds: {
    create(
      p: { payment_intent: string; amount: number; metadata: { refundId: string } },
      o: { idempotencyKey: string },
    ): Promise<{ id: string; status: string | null; failure_reason?: string | null }>;
    list(p: {
      payment_intent: string;
      limit: number;
    }): Promise<{ data: { id: string; status: string | null; metadata: Record<string, string> | null; failure_reason?: string | null }[] }>;
  };
};

export type StripeFactory = (secretKey: string) => StripeApi;

export const realStripe: StripeFactory = (secretKey) => {
  const stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 10_000 });
  return {
    // A null id retrieves the account the key belongs to.
    accounts: { retrieve: () => stripe.accounts.retrieve(null) },
    paymentIntents: stripe.paymentIntents,
    checkout: stripe.checkout,
    refunds: stripe.refunds,
  };
};

/** The event types the owner subscribes their webhook endpoint to. */
export const STRIPE_WEBHOOK_EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'checkout.session.expired',
  'refund.updated',
  'refund.failed',
] as const;

/** Exponent 0 in ISO but Stripe takes them in two-decimal form; we would charge 1/100. */
const TWO_DECIMAL_AT_STRIPE = new Set(['ISK', 'UGX']);

function supportsCurrency(currency: string): boolean {
  if (TWO_DECIMAL_AT_STRIPE.has(currency.toUpperCase())) return false;
  try {
    const exp = currencyExponent(currency);
    return exp === 0 || exp === 2;
  } catch {
    return false;
  }
}

/** A booking payment's id, or on the admin's account an owner payout's (`payoutId`). */
function paymentIdOf(obj: { metadata?: Record<string, string> | null }): string | null {
  return obj.metadata?.paymentId ?? obj.metadata?.payoutId ?? null;
}

function toGatewayRefund(r: { id: string; status: string | null; failure_reason?: string | null }): GatewayRefund {
  const status = r.status === 'succeeded' ? 'succeeded' : r.status === 'failed' || r.status === 'canceled' ? 'failed' : 'pending';
  return { refundRef: r.id, status, failureCode: r.failure_reason ?? null };
}

export function stripeGateway(factory: StripeFactory): PaymentGateway {
  return {
    key: 'stripe',

    supports: (_country, currency) => supportsCurrency(currency),

    async verifyCredentials(c) {
      try {
        const account = await factory(c.secretKey).accounts.retrieve();
        return { accountId: account.id };
      } catch (err) {
        throw new GatewayError(err instanceof Stripe.errors.StripeAuthenticationError ? 'invalid_credentials' : 'gateway_error');
      }
    },

    async createPayment(c, input) {
      const stripe = factory(c.secretKey);
      const currency = input.currency.toLowerCase();
      try {
        if (input.kind === 'intent') {
          const pi = await stripe.paymentIntents.create(
            {
              amount: input.amount,
              currency,
              automatic_payment_methods: { enabled: true },
              description: input.description,
              metadata: input.metadata,
            },
            { idempotencyKey: input.idempotencyKey },
          );
          return { gatewayRef: pi.id, linkRef: null, clientSecret: pi.client_secret, url: null };
        }
        const session = await stripe.checkout.sessions.create(
          {
            mode: 'payment',
            line_items: [
              {
                quantity: 1,
                price_data: { currency, unit_amount: input.amount, product_data: { name: input.description } },
              },
            ],
            ...(input.expiresAt ? { expires_at: Math.floor(input.expiresAt.getTime() / 1000) } : {}),
            ...(input.successUrl ? { success_url: input.successUrl } : {}),
            metadata: input.metadata,
            payment_intent_data: { metadata: input.metadata },
          },
          { idempotencyKey: input.idempotencyKey },
        );
        return { gatewayRef: null, linkRef: session.id, clientSecret: null, url: session.url };
      } catch {
        throw new GatewayError('gateway_error');
      }
    },

    handleWebhook(c, rawBody, signature) {
      if (!signature) throw new GatewayError('invalid_signature');
      let event: Stripe.Event;
      try {
        event = Stripe.webhooks.constructEvent(rawBody, signature, c.webhookSecret);
      } catch {
        throw new GatewayError('invalid_signature');
      }
      const base = { id: event.id, type: event.type, livemode: event.livemode === true };
      switch (event.type) {
        case 'payment_intent.succeeded': {
          const pi = event.data.object;
          return {
            ...base,
            kind: 'succeeded',
            paymentId: paymentIdOf(pi),
            gatewayRef: pi.id,
            amount: pi.amount_received,
            currency: pi.currency.toUpperCase(),
          } satisfies GatewayEvent;
        }
        case 'payment_intent.payment_failed': {
          const pi = event.data.object;
          return { ...base, kind: 'attempt_failed', paymentId: paymentIdOf(pi), gatewayRef: pi.id, failureCode: pi.last_payment_error?.code ?? null };
        }
        case 'payment_intent.canceled':
          return { ...base, kind: 'closed', paymentId: paymentIdOf(event.data.object), gatewayRef: event.data.object.id };
        case 'checkout.session.expired':
          return { ...base, kind: 'closed', paymentId: paymentIdOf(event.data.object), gatewayRef: null };
        case 'refund.updated':
        case 'refund.failed': {
          const r = toGatewayRefund(event.data.object);
          return { ...base, kind: 'refund_updated', refundRef: event.data.object.id, status: r.status, failureCode: r.failureCode };
        }
        default:
          return { ...base, kind: 'ignored' };
      }
    },

    async cancelPayment(c, input) {
      const ref = input.kind === 'intent' ? input.gatewayRef : input.linkRef;
      if (!ref) return;
      const stripe = factory(c.secretKey);
      try {
        // Refused once the object has succeeded or completed: its webhook is on the way.
        if (input.kind === 'intent') await stripe.paymentIntents.cancel(ref);
        else await stripe.checkout.sessions.expire(ref);
      } catch {
        throw new GatewayError('gateway_error');
      }
    },

    async refund(c, input) {
      try {
        const r = await factory(c.secretKey).refunds.create(
          { payment_intent: input.gatewayRef, amount: input.amount, metadata: { refundId: input.refundId } },
          { idempotencyKey: input.idempotencyKey },
        );
        return toGatewayRefund(r);
      } catch (err) {
        // Stripe refused the request itself (already refunded, too large, ...): retrying cannot help.
        if (err instanceof Stripe.errors.StripeInvalidRequestError) {
          return { refundRef: null, status: 'failed', failureCode: err.code ?? 'refund_declined' };
        }
        throw new GatewayError('gateway_error');
      }
    },

    async findRefund(c, input) {
      try {
        const { data } = await factory(c.secretKey).refunds.list({ payment_intent: input.gatewayRef, limit: 100 });
        const found = data.find((r) => r.metadata?.refundId === input.refundId);
        return found ? toGatewayRefund(found) : null;
      } catch {
        throw new GatewayError('gateway_error');
      }
    },
  };
}
