import { handleStripeUrl } from '../src/payment/stripe';

const SCHEME = 'bookaturf://';

/**
 * Deep links that are not screens: Stripe's 3-D Secure return goes to Stripe, and the SSLCommerz return only closes
 * the browser. Both return null so expo-router stays put instead of showing an unmatched route.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  const url = path.startsWith(SCHEME) ? path : `${SCHEME}${path.replace(/^\/+/, '')}`;
  if (url.startsWith(`${SCHEME}stripe-redirect`)) {
    void handleStripeUrl(url);
    return null;
  }
  if (url.startsWith(`${SCHEME}payment-return`)) return null;
  return path;
}
