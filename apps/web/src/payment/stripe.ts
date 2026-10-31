import { loadStripe, type Stripe, type StripeElementsOptions } from '@stripe/stripe-js';
import { stripeAppearance } from './stripeAppearance';

const stripes = new Map<string, Promise<Stripe | null>>();

/** One Stripe instance per publishable key (a venue owner's key, or the platform admin's for platform-fee payouts). */
export function stripeFor(key: string): Promise<Stripe | null> {
  let p = stripes.get(key);
  if (!p) {
    p = loadStripe(key);
    stripes.set(key, p);
    // A failed load must not stay cached, or Retry could never recover.
    p.catch(() => {
      if (stripes.get(key) === p) stripes.delete(key);
    });
  }
  return p;
}

/** Payment Element options for one intent: the app's look and the UI language. Memoize per clientSecret. */
export function elementsOptions(clientSecret: string, lang: string | undefined): StripeElementsOptions {
  return { clientSecret, appearance: stripeAppearance(), locale: lang === 'en' || lang === 'ru' ? lang : 'auto' };
}
