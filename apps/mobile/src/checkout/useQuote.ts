import { useCallback, useEffect, useRef, useState } from 'react';
import type { AddonSelection } from '@booking/shared';
import { ApiError, apiPost } from '../lib/api';
import type { QuoteResponse } from './types';

/** Add-on edits wait this long so a run of stepper taps sends one quote. */
export const QUOTE_DEBOUNCE_MS = 250;

/** A refusal of the promo code itself: shown under the field, the rest of the checkout carries on. */
export function isCouponError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code.startsWith('coupon_');
}

/** Add-on problems can be fixed in place; anything else means the slot choice must change. */
export function isAddonError(err: unknown): boolean {
  return err instanceof ApiError && (err.code.startsWith('addon_') || err.code === 'invalid_quantity');
}

export type QuoteState = {
  data: QuoteResponse | null;
  /** Why the last quote failed (not a promo refusal: that goes to `promoError`). */
  error: unknown;
  /** True until the quote for the current input has landed; Book waits for it. */
  busy: boolean;
  /** The code the next quote is asked with. */
  code: string | null;
  /** Why the last code was refused. */
  promoError: unknown;
  applyCode(code: string): void;
  removeCode(): void;
  /** The booking call refused the code (it ran out after the quote): show why and quote again without it. */
  refuseCode(err: unknown): void;
  retry(): void;
};

/**
 * Live price for the picked slots, add-ons and promo code. Mirrors the web CheckoutPage: the latest request wins,
 * a refused code keeps the last quote and quotes again without it, an add-on error keeps the quote, anything else
 * drops it so the player picks other slots.
 */
export function useQuote(slug: string, turfId: string, date: string, startAts: string[], selection: AddonSelection[]): QuoteState {
  const [data, setData] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(true);
  const [code, setCode] = useState<string | null>(null);
  const [promoError, setPromoError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const quotedKey = useRef<string | null>(null);
  const startKey = startAts.join(',');

  useEffect(() => {
    if (!slug || !turfId || !date || !startKey) return;
    let live = true;
    const key = `${turfId}|${date}|${startKey}|${code ?? ''}|${attempt}`;
    setBusy(true);
    const body = {
      date,
      startAts: startKey.split(','),
      addons: selection.filter((s) => (s.quantity ?? 1) > 0),
      ...(code ? { couponCode: code } : {}),
    };
    const run = () =>
      apiPost<QuoteResponse>(`/venues/${encodeURIComponent(slug)}/turfs/${encodeURIComponent(turfId)}/quote`, body).then(
        (res) => {
          if (!live) return;
          quotedKey.current = key;
          setData(res);
          setError(null);
          setBusy(false);
        },
        (err: unknown) => {
          if (!live) return;
          if (isCouponError(err)) {
            // Only the code was refused: keep the last quote, still busy until the code-less quote lands.
            setPromoError(err);
            setCode(null);
            return;
          }
          if (!isAddonError(err)) setData(null);
          setError(err);
          setBusy(false);
        },
      );
    // Debounce add-on edits only; a new key (mount, code, retry) goes straight away.
    const timer = setTimeout(() => void run(), quotedKey.current === key ? QUOTE_DEBOUNCE_MS : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [slug, turfId, date, startKey, selection, code, attempt]);

  const applyCode = useCallback((next: string) => {
    setPromoError(null);
    setCode(next);
  }, []);
  const removeCode = useCallback(() => {
    setPromoError(null);
    setCode(null);
  }, []);
  const refuseCode = useCallback((err: unknown) => {
    setPromoError(err);
    setCode(null);
  }, []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { data, error, busy, code, promoError, applyCode, removeCode, refuseCode, retry };
}
