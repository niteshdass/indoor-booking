import { openAuthSessionAsync } from 'expo-web-browser';

/** Return URL handed to the SSLCommerz browser session; `app/+native-intent.tsx` keeps the router from routing it. */
export const PAYMENT_RETURN_URL = 'bookaturf://payment-return';

/**
 * Hosted SSLCommerz checkout in an in-app browser. Resolves when the browser closes, however it closed: the gateway
 * returns to the web app's URL, not this scheme, so the player usually dismisses it. The caller refetches the booking
 * to learn the outcome either way.
 */
export async function openSslcommerz(url: string): Promise<void> {
  try {
    await openAuthSessionAsync(url, PAYMENT_RETURN_URL);
  } catch {
    // No browser available: the refetch afterwards still shows the booking as it is.
  }
}
