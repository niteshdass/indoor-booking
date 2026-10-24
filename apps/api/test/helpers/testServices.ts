import type { AppServices, GoogleProfile } from '../../src/services';
import { AppError } from '../../src/errors';
import Stripe from 'stripe';
import type { StripeApi, StripeFactory } from '../../src/payments/stripe';

export type StripeCall = { method: string; secretKey: string; params: object; idempotencyKey?: string };

export type FakeStripe = StripeFactory & {
  calls: StripeCall[];
  /** Makes the next call to `method` (e.g. 'paymentIntents.create') throw a Stripe auth or API error. */
  fail(method: string, kind: 'auth' | 'api'): void;
  /** Status the fake gives new refunds; 'failed' mimics a refund Stripe declines. */
  refundStatus: 'succeeded' | 'pending' | 'failed';
};

/** Stripe Checkout: `expires_at` must be at least 30 minutes after the session is created. */
const MIN_SESSION_S = 30 * 60;
/** A request reaches Stripe some time after we read the clock; the fake counts one second. */
const LATENCY_S = 1;

/**
 * In-memory Stripe: records calls, replays a repeated idempotency key, hands out sequential ids.
 * `now` is the services clock, read at call time.
 */
export function makeFakeStripe(now: () => Date = () => new Date()): FakeStripe {
  const calls: StripeCall[] = [];
  const failures = new Map<string, 'auth' | 'api'>();
  const replays = new Map<string, unknown>();
  const counters: Record<string, number> = {};
  const nextId = (prefix: string) => `${prefix}_test_${(counters[prefix] = (counters[prefix] ?? 0) + 1)}`;

  const factory = ((secretKey: string): StripeApi => {
    function call<T>(method: string, params: object, idempotencyKey: string | undefined, make: () => T): T {
      calls.push({ method, secretKey, params, ...(idempotencyKey ? { idempotencyKey } : {}) });
      const kind = failures.get(method);
      if (kind) {
        failures.delete(method);
        const message = `Invalid API Key provided: ${secretKey}`;
        const raw = { message, type: kind === 'auth' ? ('authentication_error' as const) : ('api_error' as const) };
        throw kind === 'auth' ? new Stripe.errors.StripeAuthenticationError(raw) : new Stripe.errors.StripeAPIError(raw);
      }
      if (!idempotencyKey) return make();
      const key = `${method}:${idempotencyKey}`;
      if (!replays.has(key)) replays.set(key, make());
      return replays.get(key) as T;
    }
    return {
      accounts: {
        async retrieve() {
          return call('accounts.retrieve', {}, undefined, () => ({ id: `acct_test_${secretKey.slice(-6)}` }));
        },
      },
      paymentIntents: {
        async create(params, o) {
          return call('paymentIntents.create', params, o.idempotencyKey, () => {
            const id = nextId('pi');
            return { id, client_secret: `${id}_secret_x` };
          });
        },
      },
      checkout: {
        sessions: {
          async create(params, o) {
            return call('checkout.sessions.create', params, o.idempotencyKey, () => {
              // Checked on creation only: like Stripe, a replayed key returns the stored session.
              const stripeNow = Math.floor(now().getTime() / 1000) + LATENCY_S;
              const expiresAt = (params as { expires_at?: number }).expires_at;
              if (expiresAt !== undefined && expiresAt < stripeNow + MIN_SESSION_S) {
                throw new Stripe.errors.StripeInvalidRequestError({
                  type: 'invalid_request_error',
                  message: 'expires_at must be at least 30 minutes from session creation',
                  param: 'expires_at',
                });
              }
              const id = nextId('cs');
              return { id, url: `https://checkout.stripe.test/${id}` };
            });
          },
        },
      },
      refunds: {
        async create(params, o) {
          return call('refunds.create', params, o.idempotencyKey, () => ({ id: nextId('re'), status: factory.refundStatus }));
        },
      },
    };
  }) as FakeStripe;
  factory.calls = calls;
  factory.fail = (method, kind) => void failures.set(method, kind);
  factory.refundStatus = 'succeeded';
  return factory;
}

export type TestServices = AppServices & {
  sms: AppServices['sms'] & { sent: { to: string; text: string }[] };
  email: AppServices['email'] & { sent: { to: string; subject: string; text: string }[] };
  google: AppServices['google'] & { register(idToken: string, profile: GoogleProfile): void };
  clock: { advance(ms: number): void };
  stripe: FakeStripe;
};

/** Fakes for every external effect; time starts at 2026-01-01T00:00:00Z and only moves via clock.advance. */
export function makeTestServices(): TestServices {
  let nowMs = Date.parse('2026-01-01T00:00:00Z');
  const now = () => new Date(nowMs);
  const smsSent: { to: string; text: string }[] = [];
  const emailSent: { to: string; subject: string; text: string }[] = [];
  const googleTokens = new Map<string, GoogleProfile>();
  return {
    now,
    clock: {
      advance(ms) {
        nowMs += ms;
      },
    },
    sms: {
      sent: smsSent,
      async send(to, text) {
        smsSent.push({ to, text });
      },
    },
    email: {
      sent: emailSent,
      async send(msg) {
        emailSent.push(msg);
      },
    },
    google: {
      register(idToken, profile) {
        googleTokens.set(idToken, profile);
      },
      async verify(idToken) {
        const p = googleTokens.get(idToken);
        if (!p) throw new AppError(401, 'invalid_google_token', 'Invalid Google token');
        return p;
      },
    },
    otpCode: () => '123456',
    stripe: makeFakeStripe(now),
  };
}
