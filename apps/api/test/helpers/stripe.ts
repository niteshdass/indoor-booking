import Stripe from 'stripe';

/** A signed webhook delivery, as Stripe would send it (raw body + `stripe-signature` header). */
export function signedEvent(secret: string, event: object): { body: string; signature: string } {
  const body = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  return { body, signature };
}
