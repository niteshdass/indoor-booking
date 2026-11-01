import type { AppServices, GoogleProfile } from '../../src/services';
import { AppError } from '../../src/errors';
import Stripe from 'stripe';
import type { StripeApi, StripeFactory } from '../../src/payments/stripe';
import type { SslcommerzHttp } from '../../src/payments/sslcommerz';

export type StripeCall = { method: string; secretKey: string; params: object; idempotencyKey?: string };

export type FakeStripe = StripeFactory & {
  calls: StripeCall[];
  /** Makes the next call to `method` (e.g. 'paymentIntents.create') throw a Stripe auth or API error. */
  fail(method: string, kind: 'auth' | 'api' | 'invalid_request', code?: string): void;
  /** Awaited at the start of every refunds.create, before the call is recorded. */
  onRefundCreate?: () => Promise<void>;
  /** Status the fake gives new refunds; 'failed' mimics a refund Stripe declines. */
  refundStatus: 'succeeded' | 'pending' | 'failed';
  /** Status of a PaymentIntent or Checkout Session the fake created. */
  statusOf(id: string): string | undefined;
  /** Moves an object on, e.g. a PaymentIntent to 'succeeded' or a session to 'complete'. */
  settle(id: string, status: string): void;
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
  const failures = new Map<string, { kind: 'auth' | 'api' | 'invalid_request'; code?: string }>();
  /** Refunds created, per payment intent. */
  const refundsByIntent = new Map<string, { id: string; status: string; metadata: Record<string, string> | null; failure_reason?: string | null }[]>();
  const replays = new Map<string, unknown>();
  const counters: Record<string, number> = {};
  /** Created intents and sessions: status and the key (account) that owns them. */
  const objects = new Map<string, { status: string; secretKey: string }>();
  const nextId = (prefix: string) => `${prefix}_test_${(counters[prefix] = (counters[prefix] ?? 0) + 1)}`;

  const factory = ((secretKey: string): StripeApi => {
    function call<T>(method: string, params: object, idempotencyKey: string | undefined, make: () => T): T {
      calls.push({ method, secretKey, params, ...(idempotencyKey ? { idempotencyKey } : {}) });
      const failure = failures.get(method);
      if (failure) {
        failures.delete(method);
        const { kind } = failure;
        if (kind === 'invalid_request') {
          throw new Stripe.errors.StripeInvalidRequestError({
            type: 'invalid_request_error',
            message: 'Invalid request',
            ...(failure.code ? { code: failure.code } : {}),
          });
        }
        const message = `Invalid API Key provided: ${secretKey}`;
        const raw = { message, type: kind === 'auth' ? ('authentication_error' as const) : ('api_error' as const) };
        throw kind === 'auth' ? new Stripe.errors.StripeAuthenticationError(raw) : new Stripe.errors.StripeAPIError(raw);
      }
      if (!idempotencyKey) return make();
      const key = `${method}:${idempotencyKey}`;
      if (!replays.has(key)) replays.set(key, make());
      return replays.get(key) as T;
    }
    /** Like Stripe: another account's object is missing, a final one cannot move. */
    function transition(id: string, from: string[], to: string) {
      const obj = objects.get(id);
      if (!obj || obj.secretKey !== secretKey) {
        throw new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', message: `No such object: '${id}'`, code: 'resource_missing' });
      }
      if (!from.includes(obj.status)) {
        throw new Stripe.errors.StripeInvalidRequestError({
          type: 'invalid_request_error',
          message: `You cannot move this object because it has a status of ${obj.status}.`,
        });
      }
      obj.status = to;
      return { id, status: to };
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
            objects.set(id, { status: 'requires_payment_method', secretKey });
            return { id, client_secret: `${id}_secret_x` };
          });
        },
        async cancel(id) {
          return call('paymentIntents.cancel', { id }, undefined, () =>
            transition(id, ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing'], 'canceled'),
          );
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
              objects.set(id, { status: 'open', secretKey });
              return { id, url: `https://checkout.stripe.test/${id}` };
            });
          },
          async expire(id) {
            return call('checkout.sessions.expire', { id }, undefined, () => transition(id, ['open'], 'expired'));
          },
        },
      },
      refunds: {
        async create(params, o) {
          await factory.onRefundCreate?.();
          return call('refunds.create', params, o.idempotencyKey, () => {
            const refund = { id: nextId('re'), status: factory.refundStatus, metadata: params.metadata ?? null };
            refundsByIntent.set(params.payment_intent, [...(refundsByIntent.get(params.payment_intent) ?? []), refund]);
            return refund;
          });
        },
        async list(params) {
          return call('refunds.list', params, undefined, () => ({ data: refundsByIntent.get(params.payment_intent) ?? [] }));
        },
      },
    };
  }) as FakeStripe;
  factory.calls = calls;
  factory.fail = (method, kind, code) => void failures.set(method, { kind, ...(code ? { code } : {}) });
  factory.refundStatus = 'succeeded';
  factory.statusOf = (id) => objects.get(id)?.status;
  factory.settle = (id, status) => void (objects.get(id)!.status = status);
  return factory;
}

export type SslcommerzAttempt = { status: string; valId: string | null; bankTranId: string | null; amount: string; currency: string };
export type SslcommerzSession = { host: string; storeId: string; form: Record<string, string> };

export type FakeSslcommerz = SslcommerzHttp & {
  calls: { method: 'get' | 'postForm'; url: URL; form?: Record<string, string> }[];
  sessions: SslcommerzSession[];
  /** Makes the next request to a path containing `path` throw, like a timeout. */
  fail(path: string): void;
  /** The customer pays the last session for `tranId`; returns its val_id. Defaults to the session's amount. */
  pay(tranId: string, o?: { amount?: string; currency?: string }): string;
  /** An unpaid attempt (FAILED, CANCELLED, UNATTEMPTED) for `tranId`. */
  attempt(tranId: string, status: string): void;
  /** Status the fake gives new refunds ('success' is accepted, not yet paid out); and what a later query answers. */
  refundStatus: string;
  refundQueryStatus: string;
};

/**
 * In-memory SSLCommerz. A store is its host (sandbox or live) plus its store id; a password
 * starting with "bad" is refused. Transactions are only visible to the store that opened them.
 */
export function makeFakeSslcommerz(): FakeSslcommerz {
  const calls: FakeSslcommerz['calls'] = [];
  const sessions: SslcommerzSession[] = [];
  const failures = new Set<string>();
  /** Attempts per store and tran_id. */
  const attempts = new Map<string, SslcommerzAttempt[]>();
  /** val_id -> what validation answers, and how often it has been asked. */
  const vals = new Map<string, { store: string; tranId: string; attempt: SslcommerzAttempt; asked: number }>();
  const refunds = new Map<string, { store: string; status: string }>();
  let seq = 0;
  const storeOf = (u: URL, storeId: string | null) => `${u.origin}|${storeId}`;
  const authorized = (password: string | null) => !!password && !password.startsWith('bad');
  const failing = (u: URL) => {
    for (const f of failures) if (u.pathname.includes(f)) return failures.delete(f);
    return false;
  };

  const fake: FakeSslcommerz = {
    calls,
    sessions,
    refundStatus: 'success',
    refundQueryStatus: 'refunded',
    fail: (path) => void failures.add(path),
    async postForm(raw, form) {
      const u = new URL(raw);
      calls.push({ method: 'postForm', url: u, form });
      if (failing(u)) throw new Error('fake sslcommerz timeout');
      if (!authorized(form.store_passwd ?? null)) return { status: 'FAILED', failedreason: 'Store Credential Error Or Store is De-active' };
      sessions.push({ host: u.origin, storeId: form.store_id!, form });
      seq += 1;
      return { status: 'SUCCESS', sessionkey: `sk${seq}`, GatewayPageURL: `${u.origin}/gwprocess/v4/pay/${seq}` };
    },
    async get(raw) {
      const u = new URL(raw);
      calls.push({ method: 'get', url: u });
      if (failing(u)) throw new Error('fake sslcommerz timeout');
      const q = (k: string) => u.searchParams.get(k);
      const store = storeOf(u, q('store_id'));
      const ok = authorized(q('store_passwd'));
      if (u.pathname.endsWith('/validationserverAPI.php')) {
        const v = vals.get(q('val_id') ?? '');
        if (!ok || !v || v.store !== store) return { status: 'INVALID_TRANSACTION' };
        v.asked += 1;
        return {
          status: v.asked === 1 ? 'VALID' : 'VALIDATED',
          tran_id: v.tranId,
          val_id: v.attempt.valId,
          bank_tran_id: v.attempt.bankTranId,
          amount: v.attempt.amount,
          currency: v.attempt.currency,
          currency_type: v.attempt.currency,
          currency_amount: v.attempt.amount,
        };
      }
      if (!ok) return { APIConnect: 'INVALID_REQUEST' };
      if (q('refund_ref_id')) {
        const r = refunds.get(q('refund_ref_id')!);
        if (!r || r.store !== store) return { APIConnect: 'INVALID_REQUEST' };
        return { APIConnect: 'DONE', status: fake.refundQueryStatus, refund_ref_id: q('refund_ref_id') };
      }
      if (q('bank_tran_id')) {
        const known = [...vals.values()].some((v) => v.store === store && v.attempt.bankTranId === q('bank_tran_id'));
        if (!known) return { APIConnect: 'INVALID_REQUEST', errorReason: 'Invalid bank_tran_id' };
        seq += 1;
        const ref = `rf${seq}`;
        refunds.set(ref, { store, status: fake.refundStatus });
        return { APIConnect: 'DONE', status: fake.refundStatus, refund_ref_id: ref, bank_tran_id: q('bank_tran_id') };
      }
      const list = attempts.get(`${store}|${q('tran_id')}`) ?? [];
      return {
        APIConnect: 'DONE',
        no_of_trans_found: list.length,
        element: list.map((a) => ({ tran_id: q('tran_id'), status: a.status, val_id: a.valId, bank_tran_id: a.bankTranId, amount: a.amount })),
      };
    },
    pay(tranId, o = {}) {
      const session = [...sessions].reverse().find((s) => s.form.tran_id === tranId)!;
      seq += 1;
      const attempt = {
        status: 'VALID',
        valId: `val${seq}`,
        bankTranId: `bank${seq}`,
        amount: o.amount ?? session.form.total_amount!,
        currency: o.currency ?? session.form.currency!,
      };
      const key = `${session.host}|${session.storeId}`;
      attempts.set(`${key}|${tranId}`, [...(attempts.get(`${key}|${tranId}`) ?? []), attempt]);
      vals.set(attempt.valId, { store: key, tranId, attempt, asked: 0 });
      return attempt.valId;
    },
    attempt(tranId, status) {
      const session = [...sessions].reverse().find((s) => s.form.tran_id === tranId)!;
      const key = `${session.host}|${session.storeId}|${tranId}`;
      const a = { status, valId: null, bankTranId: null, amount: session.form.total_amount!, currency: session.form.currency! };
      attempts.set(key, [...(attempts.get(key) ?? []), a]);
    },
  };
  return fake;
}

export type TestServices = AppServices & {
  sms: AppServices['sms'] & { sent: { to: string; text: string }[] };
  email: AppServices['email'] & { sent: { to: string; subject: string; text: string }[] };
  google: AppServices['google'] & { register(idToken: string, profile: GoogleProfile): void };
  clock: { advance(ms: number): void };
  stripe: FakeStripe;
  sslcommerz: FakeSslcommerz;
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
    sslcommerz: makeFakeSslcommerz(),
  };
}
