import { handleURLCallback, initPaymentSheet, initStripe, presentPaymentSheet } from '@stripe/stripe-react-native';

/** Where Stripe sends the player back after a 3-D Secure or bank redirect; `app/+native-intent.tsx` hands it to Stripe. */
export const STRIPE_RETURN_URL = 'bookaturf://stripe-redirect';

export type StripeOutcome = { kind: 'completed' } | { kind: 'canceled' } | { kind: 'failed'; message: string };

let initializedKey: string | null = null;

/**
 * Card payment through the Stripe PaymentSheet. The publishable key comes from `POST /bookings/:id/payment`
 * (it is per platform account, not a build-time setting), so Stripe is initialised here with `initStripe`
 * and awaited before the sheet, rather than through `<StripeProvider>` whose effect gives no completion signal.
 */
export async function payWithStripe(input: { publishableKey: string; clientSecret: string; merchantName: string }): Promise<StripeOutcome> {
  if (initializedKey !== input.publishableKey) {
    await initStripe({ publishableKey: input.publishableKey, urlScheme: 'bookaturf' });
    initializedKey = input.publishableKey;
  }
  const init = await initPaymentSheet({
    paymentIntentClientSecret: input.clientSecret,
    merchantDisplayName: input.merchantName,
    returnURL: STRIPE_RETURN_URL,
  });
  if (init.error) return { kind: 'failed', message: init.error.localizedMessage ?? init.error.message };
  const res = await presentPaymentSheet();
  if (res.error) return res.error.code === 'Canceled' ? { kind: 'canceled' } : { kind: 'failed', message: res.error.localizedMessage ?? res.error.message };
  if (res.didCancel) return { kind: 'canceled' };
  return { kind: 'completed' };
}

/** True when `url` was a Stripe redirect return and Stripe handled it. */
export function handleStripeUrl(url: string): Promise<boolean> {
  return url.startsWith(STRIPE_RETURN_URL) ? handleURLCallback(url) : Promise.resolve(false);
}
