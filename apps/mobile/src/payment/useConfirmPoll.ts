import { useEffect, useRef } from 'react';
import type { PlayerBooking } from '../bookings/types';

/** Same pace as the web booking page after a payment returns. */
export const POLL_MS = 2000;
export const POLL_BUDGET_MS = 60_000;

/**
 * While `active`, refetches the booking right away and then every POLL_MS, waiting for the gateway's webhook to move it
 * out of awaiting_payment. The caller turns `active` off once the status changes (which stops the poll); if that has not
 * happened within POLL_BUDGET_MS, `onTimeout` runs once. Timers are cleared on unmount and whenever `active` drops.
 */
export function useConfirmPoll(active: boolean, refetch: () => Promise<PlayerBooking | null>, onTimeout: () => void): void {
  const timeoutRef = useRef(onTimeout);
  useEffect(() => {
    timeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    if (!active) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      // refetch() never throws; a failed look simply waits for the next one.
      await refetch();
      if (live) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    const giveUp = setTimeout(() => {
      if (!live) return;
      live = false;
      clearTimeout(timer);
      timeoutRef.current();
    }, POLL_BUDGET_MS);
    return () => {
      live = false;
      clearTimeout(timer);
      clearTimeout(giveUp);
    };
  }, [active, refetch]);
}
