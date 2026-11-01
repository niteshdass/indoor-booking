import { randomBytes } from 'node:crypto';
import { currencyExponent } from '@booking/shared';
import {
  GatewayError,
  type GatewayCredentials,
  type GatewayEvent,
  type GatewayRefund,
  type PaymentGateway,
  type SslcommerzCredentials,
} from './gateway';

/**
 * The two calls we make to SSLCommerz, so tests can inject a fake. Both resolve to the parsed JSON
 * body and throw on a network failure, a timeout or a non-2xx status.
 */
export type SslcommerzHttp = {
  get(url: string): Promise<unknown>;
  postForm(url: string, form: Record<string, string>): Promise<unknown>;
};

const TIMEOUT_MS = 10_000;

async function jsonOf(res: Response): Promise<unknown> {
  if (!res.ok) throw new Error(`SSLCommerz answered ${res.status}`);
  return res.json();
}

export const realSslcommerz: SslcommerzHttp = {
  get: async (url) => jsonOf(await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })),
  postForm: async (url, form) =>
    jsonOf(await fetch(url, { method: 'POST', body: new URLSearchParams(form), signal: AbortSignal.timeout(TIMEOUT_MS) })),
};

export const SSLCOMMERZ_HOSTS = { test: 'https://sandbox.sslcommerz.com', live: 'https://securepay.sslcommerz.com' } as const;

const own = (c: GatewayCredentials) => c as SslcommerzCredentials;
const hostOf = (c: SslcommerzCredentials) => SSLCOMMERZ_HOSTS[c.live ? 'live' : 'test'];
const auth = (c: SslcommerzCredentials) => ({ store_id: c.storeId, store_passwd: c.storePassword, format: 'json' });

function url(c: SslcommerzCredentials, path: string, params: Record<string, string>): string {
  const u = new URL(path, hostOf(c));
  for (const [k, v] of Object.entries({ ...params, ...auth(c) })) u.searchParams.set(k, v);
  return u.toString();
}

type Fields = Record<string, unknown>;
const str = (o: Fields, key: string): string | null => {
  const v = o[key];
  return typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null;
};

/** SSLCommerz speaks decimal amounts ("1500.00"); we store minor units. */
export const toDecimal = (minor: number, currency: string) => {
  const exp = currencyExponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
};
const toMinor = (decimal: string, currency: string) => Math.round(Number(decimal) * 10 ** currencyExponent(currency));

/** A transaction that has been paid. VALIDATED is VALID asked about a second time. */
const PAID = new Set(['VALID', 'VALIDATED']);

/** A paid transaction, confirmed by the Order Validation API with our own credentials. */
async function validated(http: SslcommerzHttp, c: SslcommerzCredentials, valId: string, livemode: boolean): Promise<GatewayEvent> {
  let body: Fields;
  try {
    body = (await http.get(url(c, '/validator/api/validationserverAPI.php', { val_id: valId, v: '1' }))) as Fields;
  } catch {
    throw new GatewayError('gateway_error');
  }
  const status = str(body, 'status');
  // Unknown to this store: forged, or sent to the other mode's keys.
  if (status === 'INVALID_TRANSACTION') throw new GatewayError('invalid_signature');
  const tranId = str(body, 'tran_id');
  const bankTranId = str(body, 'bank_tran_id');
  if (!status || !PAID.has(status) || !tranId || !bankTranId) throw new GatewayError('gateway_error');
  // `currency_type`/`currency_amount` are what the session asked for; `currency`/`amount` the settlement.
  const currency = (str(body, 'currency_type') ?? str(body, 'currency') ?? '').toUpperCase();
  const decimal = str(body, 'currency_amount') ?? str(body, 'amount') ?? '';
  let amount: number;
  try {
    amount = toMinor(decimal, currency);
  } catch {
    throw new GatewayError('gateway_error');
  }
  if (!Number.isSafeInteger(amount)) throw new GatewayError('gateway_error');
  return {
    id: `val_${valId}`,
    type: `transaction.${status.toLowerCase()}`,
    livemode,
    kind: 'succeeded',
    paymentId: tranId,
    gatewayRef: bankTranId,
    amount,
    currency,
  };
}

/** Every attempt the store has on record for `tranId`; null when the credentials were refused. */
async function attemptsOf(http: SslcommerzHttp, c: SslcommerzCredentials, tranId: string): Promise<Fields[] | null> {
  let body: Fields;
  try {
    body = (await http.get(url(c, '/validator/api/merchantTransIDvalidationAPI.php', { tran_id: tranId }))) as Fields;
  } catch {
    throw new GatewayError('gateway_error');
  }
  if (str(body, 'APIConnect') !== 'DONE') return null;
  return Array.isArray(body.element) ? (body.element as Fields[]) : [];
}

function toGatewayRefund(body: Fields, fallbackRef: string | null): GatewayRefund {
  const refundRef = str(body, 'refund_ref_id') ?? fallbackRef;
  const status = (str(body, 'status') ?? '').toLowerCase();
  if (status === 'refunded') return { refundRef, status: 'succeeded', failureCode: null };
  if (status === 'failed' || status === 'cancelled') {
    return { refundRef, status: 'failed', failureCode: status === 'cancelled' ? 'refund_cancelled' : 'refund_declined' };
  }
  // 'success' answers the request (accepted, not yet paid out); 'processing' is on its way.
  return { refundRef, status: 'pending', failureCode: null };
}

/**
 * SSLCommerz hosted checkout (bKash, Nagad, Rocket, cards). The notification carries no signature
 * we rely on: a paid one is checked with the Order Validation API and anything else with the
 * transaction query, both with the store's own credentials, so a forged post changes nothing.
 */
export function sslcommerzGateway(http: SslcommerzHttp): PaymentGateway {
  return {
    key: 'sslcommerz',
    hosted: true,

    supports: (country, currency) => country === 'BD' && currency.toUpperCase() === 'BDT',

    async verifyCredentials(c) {
      // There is no "who am I" call; a lookup of a transaction that cannot exist answers DONE only for good credentials.
      const attempts = await attemptsOf(http, own(c), `verify_${randomBytes(6).toString('hex')}`);
      if (!attempts) throw new GatewayError('invalid_credentials');
      return { accountId: own(c).storeId };
    },

    async createPayment(c, input) {
      const s = own(c);
      if (!input.returnUrl || !input.notifyUrl) throw new GatewayError('gateway_error');
      const back = (result: 'success' | 'fail' | 'cancel') => {
        const u = new URL(input.returnUrl!);
        u.searchParams.set('result', result);
        return u.toString();
      };
      const customer = input.customer ?? { name: 'Customer', email: null, phone: null };
      let body: Fields;
      try {
        body = (await http.postForm(new URL('/gwprocess/v4/api.php', hostOf(s)).toString(), {
          store_id: s.storeId,
          store_passwd: s.storePassword,
          total_amount: toDecimal(input.amount, input.currency),
          currency: input.currency.toUpperCase(),
          // Our payment id: the validation answer names it, and a retried session reuses it.
          tran_id: input.metadata.paymentId!,
          success_url: back('success'),
          fail_url: back('fail'),
          cancel_url: back('cancel'),
          ipn_url: input.notifyUrl,
          product_name: input.description.slice(0, 255),
          product_category: 'Sports booking',
          product_profile: 'non-physical-goods',
          shipping_method: 'NO',
          num_of_item: '1',
          // Required by the session API; a player may have given only a phone or only an email.
          cus_name: customer.name || 'Customer',
          cus_email: customer.email ?? 'customer@example.com',
          cus_phone: customer.phone ?? '01700000000',
          cus_add1: 'N/A',
          cus_city: 'N/A',
          cus_country: 'Bangladesh',
          value_a: input.metadata.paymentId!,
          value_b: input.metadata.bookingId ?? '',
          value_c: input.metadata.ownerId ?? '',
        })) as Fields;
      } catch {
        throw new GatewayError('gateway_error');
      }
      const page = str(body, 'GatewayPageURL');
      if (str(body, 'status') !== 'SUCCESS' || !page) {
        // A refused store id or password; the reason text could echo it, so it is not kept.
        throw new GatewayError(/store|credential|passw/i.test(str(body, 'failedreason') ?? '') ? 'invalid_credentials' : 'gateway_error');
      }
      // The tran_id, not the session: every row of a group and every retried session share it.
      return { gatewayRef: null, linkRef: input.metadata.paymentId!, clientSecret: null, url: page };
    },

    async handleWebhook(c, delivery) {
      const s = own(c);
      const form = Object.fromEntries(new URLSearchParams(delivery.rawBody.toString('utf8')));
      const status = (form.status ?? '').toUpperCase();
      if (PAID.has(status) && form.val_id) return validated(http, s, form.val_id, s.live);

      const tranId = form.tran_id;
      if (!tranId) throw new GatewayError('invalid_signature');
      const attempts = await attemptsOf(http, s, tranId);
      if (!attempts || attempts.length === 0) throw new GatewayError('invalid_signature');
      // The store's record wins over the post: a paid attempt settles the payment whatever the post said.
      const paid = attempts.find((a) => PAID.has((str(a, 'status') ?? '').toUpperCase()) && str(a, 'val_id'));
      if (paid) return validated(http, s, str(paid, 'val_id')!, s.live);
      // Retried sessions share the tran_id, so a failed attempt keeps the payment open; the sweep closes it.
      const code = (status || 'failed').toLowerCase();
      return {
        id: `tran_${tranId}_${code}_${attempts.length}`,
        type: `transaction.${code}`,
        livemode: s.live,
        kind: 'attempt_failed',
        paymentId: tranId,
        gatewayRef: null,
        failureCode: code,
      };
    },

    async lookupPayment(c, input) {
      const s = own(c);
      const attempts = await attemptsOf(http, s, input.paymentId);
      if (!attempts) throw new GatewayError('gateway_error');
      const paid = attempts.find((a) => PAID.has((str(a, 'status') ?? '').toUpperCase()) && str(a, 'val_id'));
      return paid ? validated(http, s, str(paid, 'val_id')!, s.live) : null;
    },

    async cancelPayment(c, input) {
      // Sessions cannot be cancelled, only left to expire; refuse once one has been paid (its notice is on the way).
      const attempts = await attemptsOf(http, own(c), input.linkRef ?? input.paymentId);
      if (!attempts) throw new GatewayError('gateway_error');
      if (attempts.some((a) => PAID.has((str(a, 'status') ?? '').toUpperCase()))) throw new GatewayError('gateway_error');
    },

    async refund(c, input) {
      const s = own(c);
      let body: Fields;
      try {
        body = (await http.get(
          url(s, '/validator/api/merchantTransIDvalidationAPI.php', {
            bank_tran_id: input.gatewayRef,
            refund_amount: toDecimal(input.amount, input.currency),
            refund_remarks: 'Booking refund',
            refe_id: input.refundId,
          }),
        )) as Fields;
      } catch {
        throw new GatewayError('gateway_error');
      }
      const connect = str(body, 'APIConnect');
      // The request itself was refused (bad amount, unknown transaction): retrying cannot help.
      if (connect === 'INVALID_REQUEST') return { refundRef: null, status: 'failed', failureCode: 'refund_declined' };
      if (connect !== 'DONE') throw new GatewayError('gateway_error');
      return toGatewayRefund(body, null);
    },

    async findRefund(c, input) {
      // Without its reference a refund cannot be looked up; sending it again could pay it twice.
      if (!input.refundRef) throw new GatewayError('gateway_error');
      const s = own(c);
      let body: Fields;
      try {
        body = (await http.get(url(s, '/validator/api/merchantTransIDvalidationAPI.php', { refund_ref_id: input.refundRef }))) as Fields;
      } catch {
        throw new GatewayError('gateway_error');
      }
      if (str(body, 'APIConnect') !== 'DONE') throw new GatewayError('gateway_error');
      return toGatewayRefund(body, input.refundRef);
    },
  };
}
