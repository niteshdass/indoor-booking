import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { apiGet, apiPost, ApiError } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { money } from '../lib/format';
import type { BookingJson, PaymentStart } from '../lib/types';
import { stripeAppearance } from './stripeAppearance';
import { useCountdown } from './useCountdown';
import styles from './PayPage.module.css';

const stripes = new Map<string, Promise<Stripe | null>>();
/** One Stripe instance per publishable key (the key is per venue owner). */
function stripeFor(key: string): Promise<Stripe | null> {
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

type State =
  | { status: 'loading' }
  | { status: 'ready'; booking: BookingJson; start: PaymentStart }
  | { status: 'redirect' }
  | { status: 'expired'; booking: BookingJson | null }
  | { status: 'error'; error: unknown; loadFailed?: boolean };

function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function PayForm({ id, start, expired, onConfirming }: { id: string; start: PaymentStart; expired: boolean; onConfirming(v: boolean): void }) {
  const { t, i18n } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { payment } = start;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || inflight.current || expired) return;
    inflight.current = true;
    onConfirming(true);
    setBusy(true);
    setError(null);
    let failed = false;
    const paidPath = `/me/bookings/${encodeURIComponent(id)}?paid=1`;
    try {
      const res = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.origin + paidPath },
        redirect: 'if_required',
      });
      if (!mounted.current) return;
      if (res.error) {
        setError(res.error.message ?? t('errors.generic'));
        failed = true;
      } else {
        // Paid: keep `confirming` set so the page never swaps to Expired before navigation.
        navigate(paidPath);
      }
    } catch (err) {
      if (mounted.current) setError(errorMessage(err, t));
      failed = true;
    } finally {
      inflight.current = false;
      if (mounted.current) {
        setBusy(false);
        if (failed) onConfirming(false);
      }
    }
  };

  return (
    <form className={styles.card} onSubmit={(e) => void onSubmit(e)}>
      <p className={styles.amount}>{t('payment.payNow', { amount: money(payment.amount, payment.currency, i18n.language) })}</p>
      <PaymentElement />
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" size="lg" block loading={busy} disabled={!stripe || !elements || busy}>
        {t('payment.pay')}
      </Button>
    </form>
  );
}

function Expired({ slug }: { slug: string | null }) {
  const { t } = useTranslation();
  return (
    <div className={styles.expired}>
      <Alert tone="warning">{t('payment.expired')}</Alert>
      {slug && (
        <Button to={`/venues/${encodeURIComponent(slug)}`} variant="secondary">
          {t('payment.backToVenue')}
        </Button>
      )}
    </div>
  );
}

function PayElements({ id, booking, start }: { id: string; booking: BookingJson; start: PaymentStart }) {
  const { t, i18n } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const { msLeft, expired } = useCountdown(start.holdExpiresAt);
  const stripe = useMemo(() => stripeFor(start.payment.publishableKey), [start.payment.publishableKey]);
  // Computed once per payment start so Elements never sees a changing clientSecret/appearance.
  const options = useMemo(
    () => ({ clientSecret: start.payment.clientSecret, appearance: stripeAppearance(), locale: (i18n.resolvedLanguage === 'en' || i18n.resolvedLanguage === 'ru' ? i18n.resolvedLanguage : 'auto') as 'en' | 'ru' | 'auto' }),
    [start.payment.clientSecret, i18n.resolvedLanguage],
  );
  if (expired && !confirming) return <Expired slug={booking.venue?.slug ?? null} />;
  return (
    <>
      <p className={styles.hold} aria-live="off">
        {t('payment.holdEndsIn', { time: formatClock(msLeft) })}
      </p>
      <Elements stripe={stripe} options={options}>
        <PayForm id={id} start={start} expired={expired} onConfirming={setConfirming} />
      </Elements>
    </>
  );
}

export function PayPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    const base = `/me/bookings/${encodeURIComponent(id)}`;
    (async () => {
      let booking: BookingJson | null = null;
      try {
        booking = (await apiGet<{ booking: BookingJson }>(base)).booking;
        if (booking.status !== 'awaiting_payment') {
          if (live) setState({ status: 'redirect' });
          return;
        }
        const start = await apiPost<PaymentStart>(`/bookings/${encodeURIComponent(id)}/payment`, {});
        try {
          await stripeFor(start.payment.publishableKey);
        } catch (error) {
          if (live) setState({ status: 'error', error, loadFailed: true });
          return;
        }
        if (live) setState({ status: 'ready', booking, start });
      } catch (error) {
        if (!live) return;
        if (error instanceof ApiError && (error.code === 'already_paid' || error.code === 'invalid_transition')) setState({ status: 'redirect' });
        else if (error instanceof ApiError && error.code === 'hold_expired') setState({ status: 'expired', booking });
        else setState({ status: 'error', error });
      }
    })();
    return () => {
      live = false;
    };
  }, [id, attempt]);

  if (state.status === 'redirect') return <Navigate to={`/me/bookings/${encodeURIComponent(id)}`} replace />;

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t('payment.title')}</h1>
      {state.status === 'loading' && (
        <div className={styles.loading}>
          <Spinner label={t('common.loading')} />
        </div>
      )}
      {state.status === 'error' && (
        <Alert tone="danger" className={styles.alert}>
          <span>{state.loadFailed ? t('payment.loadFailed') : errorMessage(state.error, t)}</span>
          <Button size="sm" variant="secondary" onClick={load}>
            {t('search.retry')}
          </Button>
        </Alert>
      )}
      {state.status === 'expired' && <Expired slug={state.booking?.venue?.slug ?? null} />}
      {state.status === 'ready' && <PayElements id={id} booking={state.booking} start={state.start} />}
    </main>
  );
}
