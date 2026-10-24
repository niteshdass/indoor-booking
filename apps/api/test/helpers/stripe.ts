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
  const res = await request(app)
    .put(`/api/v1/owners/${owner.ownerId}/payment-gateways/stripe`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({
      secretKey: opts.secretKey ?? `sk_test_owner${ownerSeq}`,
      publishableKey: `pk_test_owner${ownerSeq}`,
      webhookSecret,
      ...(opts.enabled === undefined ? {} : { enabled: opts.enabled }),
    });
  if (res.status !== 200) throw new Error(`connectStripe failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { webhookSecret, accountId: res.body.gateway.accountId };
}
