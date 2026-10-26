import type { Express } from 'express';
import request from 'supertest';
import Stripe from 'stripe';

/** A signed webhook delivery, as Stripe would send it (raw body + `stripe-signature` header). */
export function signedEvent(secret: string, event: object): { body: string; signature: string } {
  const body = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  return { body, signature };
}

let ownerSeq = 0;

/** Connects Stripe for an owner through the real route; returns the webhook secret and account id. */
export async function connectStripe(
  app: Express,
  owner: { ownerId: string; token: string },
  opts: { secretKey?: string; webhookSecret?: string; enabled?: boolean } = {},
): Promise<{ webhookSecret: string; accountId: string }> {
  ownerSeq += 1;
  const webhookSecret = opts.webhookSecret ?? `whsec_owner${ownerSeq}`;
  const secretKey = opts.secretKey ?? `sk_test_owner${ownerSeq}`;
  const mode = secretKey.split('_')[1];
  const res = await request(app)
    .put(`/api/v1/owners/${owner.ownerId}/payment-gateways/stripe`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({
      secretKey,
      publishableKey: `pk_${mode}_owner${ownerSeq}`,
      webhookSecret,
      ...(opts.enabled === undefined ? {} : { enabled: opts.enabled }),
    });
  if (res.status !== 200) throw new Error(`connectStripe failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { webhookSecret, accountId: res.body.gateway.accounts[mode!].accountId };
}

/** Posts a delivery to the owner's Stripe webhook URL, signed with `webhookSecret`. */
export function postEvent(app: Express, ownerId: string, webhookSecret: string, event: object): request.Test {
  const { body, signature } = signedEvent(webhookSecret, event);
  return request(app)
    .post(`/api/v1/webhooks/stripe/${ownerId}`)
    .set('stripe-signature', signature)
    .set('Content-Type', 'application/json')
    .send(body);
}

type PaymentLike = { _id: unknown; amount: number; currency: string; gatewayRef?: string | null };

let eventSeq = 0;

function stripeEvent(type: string, object: object, id?: string) {
  eventSeq += 1;
  return { id: id ?? `evt_${eventSeq}`, object: 'event', type, data: { object } };
}

const intentOf = (p: PaymentLike, paymentId = String(p._id)) => ({
  id: p.gatewayRef ?? `pi_for_${paymentId}`,
  object: 'payment_intent',
  amount: p.amount,
  currency: p.currency.toLowerCase(),
  metadata: { paymentId },
});

export function piSucceeded(
  p: PaymentLike,
  o: { id?: string; amount?: number; currency?: string; paymentId?: string } = {},
) {
  const pi = intentOf(p, o.paymentId);
  return stripeEvent(
    'payment_intent.succeeded',
    { ...pi, amount_received: o.amount ?? p.amount, currency: o.currency ?? pi.currency, status: 'succeeded' },
    o.id,
  );
}

export function piFailed(p: PaymentLike, o: { id?: string; code?: string } = {}) {
  return stripeEvent(
    'payment_intent.payment_failed',
    { ...intentOf(p), amount_received: 0, last_payment_error: { code: o.code ?? 'card_declined' } },
    o.id,
  );
}

export function piCanceled(p: PaymentLike, o: { id?: string } = {}) {
  return stripeEvent('payment_intent.canceled', { ...intentOf(p), status: 'canceled' }, o.id);
}

export function sessionExpired(p: PaymentLike, o: { id?: string } = {}) {
  return stripeEvent(
    'checkout.session.expired',
    { id: `cs_for_${String(p._id)}`, object: 'checkout.session', metadata: { paymentId: String(p._id) } },
    o.id,
  );
}
