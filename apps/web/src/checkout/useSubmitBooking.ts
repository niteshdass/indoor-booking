import { useCallback, useState } from 'react';
import type { AddonSelection } from '@booking/shared';
import { apiPost } from '../lib/apiClient';
import type { BookingJson } from '../lib/types';

export type SubmitInput = {
  date: string;
  startAts: string[];
  addons: AddonSelection[];
  guest?: { name: string; phone: string; otpCode?: string };
};

/** Creates the booking; the bearer token (if any) is attached by the API client. */
export function useSubmitBooking(slug: string, turfId: string): { submit(input: SubmitInput): Promise<BookingJson>; pending: boolean } {
  const [pending, setPending] = useState(false);
  const submit = useCallback(
    async (input: SubmitInput) => {
      setPending(true);
      try {
        const res = await apiPost<{ booking: BookingJson }>(
          `/venues/${encodeURIComponent(slug)}/turfs/${encodeURIComponent(turfId)}/bookings`,
          input,
        );
        return res.booking;
      } finally {
        setPending(false);
      }
    },
    [slug, turfId],
  );
  return { submit, pending };
}
