import { useCallback, useRef, useState } from 'react';
import type { AddonSelection } from '@booking/shared';
import { apiPost } from '../lib/apiClient';
import type { BookingJson } from '../lib/types';
import type { CheckoutItem } from './checkoutParams';

export type SubmitInput = {
  date: string;
  startAts: string[];
  addons: AddonSelection[];
  /** More bookings at their own days and times; a signed-in player only. */
  more?: CheckoutItem[];
  guest?: { name: string; phone: string; otpCode?: string };
  /** The promo code the shown quote applied. */
  couponCode?: string;
};

/**
 * Creates the booking; the bearer token (if any) is attached by the API client. Sending the same
 * request again (a retry after a dropped response) reuses its Idempotency-Key, so the API hands
 * back the booking it already made instead of holding the slots twice.
 */
export function useSubmitBooking(slug: string, turfId: string): { submit(input: SubmitInput): Promise<BookingJson>; pending: boolean } {
  const [pending, setPending] = useState(false);
  const last = useRef<{ path: string; body: string; key: string } | null>(null);
  const submit = useCallback(
    async (input: SubmitInput) => {
      setPending(true);
      const path = `/venues/${encodeURIComponent(slug)}/turfs/${encodeURIComponent(turfId)}/bookings`;
      const body = JSON.stringify(input);
      if (last.current?.path !== path || last.current.body !== body) last.current = { path, body, key: crypto.randomUUID() };
      try {
        const res = await apiPost<{ booking: BookingJson }>(path, input, { 'Idempotency-Key': last.current.key });
        return res.booking;
      } finally {
        setPending(false);
      }
    },
    [slug, turfId],
  );
  return { submit, pending };
}
