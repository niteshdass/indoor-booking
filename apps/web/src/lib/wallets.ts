import type { WalletProvider } from '@booking/shared';

/** Provider names stay as words in every language. */
export const PROVIDER_NAMES: Record<WalletProvider, string> = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket' };

const BD_MOBILE = /^(?:\+880|0)(1[3-9]\d{8})$/;

/** The 10 digits after the country code (1712345678) of a number the API accepts (+8801712345678 or 01712345678), else null. */
export function bdMobileDigits(raw: string): string | null {
  return BD_MOBILE.exec(raw.replace(/[\s-]/g, ''))?.[1] ?? null;
}

/** `+8801712345678` -> `+880 1712-345678`; anything else is shown as typed. */
export function formatBdMobile(raw: string): string {
  const d = bdMobileDigits(raw);
  return d ? `+880 ${d.slice(0, 4)}-${d.slice(4)}` : raw;
}
