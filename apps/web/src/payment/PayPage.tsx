import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { Tabs } from '../components/ui/Tabs';
import { apiGet, apiPost, ApiError } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { money } from '../lib/format';
import type { BookingJson, PaymentOptions, PaymentStart } from '../lib/types';
import { PROVIDER_NAMES } from '../lib/wallets';
import { stripeAppearance } from './stripeAppearance';
import { useCountdown } from './useCountdown';
import { BookingLine, HoldPill } from './BookingLine';
import { WalletPayForm, type ManualOutcome } from './WalletPayForm';
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
  | { status: 'ready'; booking: BookingJson; options: PaymentOptions }
  | { status: 'redirect' }
  | { status: 'expired'; booking: BookingJson | null }
  | { status: 'error'; error: unknown };

function PayForm({
  id,
  booking,
  start,
  msLeft,
  expired,
  onConfirming,
}: {
  id: string;
  booking: BookingJson;
  start: PaymentStart;
  msLeft: number;
  expired: boolean;
  onConfirming(v: boolean): void;
}) {
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
      <div className={styles.head}>
        <div className={styles.headTop}>
          <p className={styles.amount}>{t('payment.payNow', { amount: money(payment.amount, payment.currency, i18n.language) })}</p>
          <HoldPill msLeft={msLeft} />
        </div>
        <BookingLine booking={booking} />
      </div>
      <PaymentElement />
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" size="lg" icon="card" block loading={busy} disabled={!stripe || !elements || busy}>
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
        <Button to={`/venues/${encodeURIComponent(slug)}`} variant="secondary" icon="arrowLeft">
          {t('payment.backToVenue')}
        </Button>
      )}
    </div>
  );
}

type CardState =
  | { status: 'loading' }
  | { status: 'ready'; start: PaymentStart }
  | { status: 'redirect' }
  | { status: 'error'; error: unknown; loadFailed?: boolean };

/** Starts the Stripe intent when it first mounts, so it only runs once the Card tab is chosen. */
function CardPane({
  id,
  booking,
  msLeft,
  expired,
  onConfirming,
  onHoldExpired,
}: {
  id: string;
  booking: BookingJson;
  msLeft: number;
  expired: boolean;
  onConfirming(v: boolean): void;
  onHoldExpired(): void;
}) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<CardState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    (async () => {
      try {
        const start = await apiPost<PaymentStart>(`/bookings/${encodeURIComponent(id)}/payment`, {});
        try {
          await stripeFor(start.payment.publishableKey);
        } catch (error) {
          if (live) setState({ status: 'error', error, loadFailed: true });
          return;
        }
        if (live) setState({ status: 'ready', start });
      } catch (error) {
        if (!live) return;
        if (error instanceof ApiError && (error.code === 'already_paid' || error.code === 'invalid_transition')) setState({ status: 'redirect' });
        else if (error instanceof ApiError && error.code === 'hold_expired') onHoldExpired();
        else setState({ status: 'error', error });
      }
    })();
    return () => {
      live = false;
    };
    // onHoldExpired is a stable state setter wrapper.
  }, [id, attempt]);

  if (state.status === 'redirect') return <Navigate to={`/me/bookings/${encodeURIComponent(id)}`} replace />;
  if (state.status === 'loading') return <Skeleton kind="detail" label={t('common.loading')} />;
  if (state.status === 'error') {
    return (
      <Alert tone="danger" className={styles.alert}>
        <span>{state.loadFailed ? t('payment.loadFailed') : errorMessage(state.error, t)}</span>
        <Button size="sm" variant="secondary" icon="refresh" onClick={() => setAttempt((n) => n + 1)}>
          {t('search.retry')}
        </Button>
      </Alert>
    );
  }
  return <CardElements id={id} booking={booking} start={state.start} msLeft={msLeft} expired={expired} onConfirming={onConfirming} lang={i18n.resolvedLanguage} />;
}

function CardElements({
  id,
  booking,
  start,
  msLeft,
  expired,
  onConfirming,
  lang,
}: {
  id: string;
  booking: BookingJson;
  start: PaymentStart;
  msLeft: number;
  expired: boolean;
  onConfirming(v: boolean): void;
  lang: string | undefined;
}) {
  const stripe = useMemo(() => stripeFor(start.payment.publishableKey), [start.payment.publishableKey]);
  // Computed once per payment start so Elements never sees a changing clientSecret/appearance.
  const options = useMemo(
    () => ({ clientSecret: start.payment.clientSecret, appearance: stripeAppearance(), locale: (lang === 'en' || lang === 'ru' ? lang : 'auto') as 'en' | 'ru' | 'auto' }),
    [start.payment.clientSecret, lang],
  );
  return (
    <Elements stripe={stripe} options={options}>
      <PayForm id={id} booking={booking} start={start} msLeft={msLeft} expired={expired} onConfirming={onConfirming} />
    </Elements>
  );
}

/** Tabs for each way to pay; the hold countdown is shared by all of them. */
function PayMethods({ id, booking, options }: { id: string; booking: BookingJson; options: PaymentOptions }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hold = options.holdExpiresAt ?? booking.holdExpiresAt;
  const { msLeft, expired } = useCountdown(hold);
  // A wallet transfer can take longer than the hold, so its form stays after the hold ends: the API
  // revives the booking if the times are still free, or keeps the money to send back if not.
  const holdEnded = expired || booking.status === 'expired';
  const [confirming, setConfirming] = useState(false);
  const [lapsed, setLapsed] = useState(false);
  const onHoldExpired = useCallback(() => setLapsed(true), []);
  const ids = [...(options.card ? ['card'] : []), ...options.wallets.map((w) => w.provider)];
  // Wallets open first when offered, so a card intent is never started unasked.
  const [tab, setTab] = useState<string>(options.wallets[0]?.provider ?? 'card');
  const [cardSeen, setCardSeen] = useState(tab === 'card');
  const choose = (next: string) => {
    setTab(next);
    if (next === 'card') setCardSeen(true);
  };

  if (ids.length === 0) return <Alert tone="warning">{t('checkout.noMethods')}</Alert>;
  const cardOver = (holdEnded && !confirming) || lapsed;

  const wallet = options.wallets.find((w) => w.provider === tab);
  const done = (outcome: ManualOutcome) =>
    navigate(`/me/bookings/${encodeURIComponent(id)}?submitted=1${outcome === 'slots_taken' ? '&late=1' : ''}`);

  return (
    <>
      {ids.length > 1 && (
        <Tabs
          label={t('payment.wallet.tabs')}
          tabs={ids.map((x) => ({ id: x, label: x === 'card' ? t('payment.wallet.card') : PROVIDER_NAMES[x as keyof typeof PROVIDER_NAMES] }))}
          value={tab}
          onChange={choose}
        />
      )}
      {tab === 'card' && cardOver && <Expired slug={booking.venue?.slug ?? null} />}
      {cardSeen && !cardOver && (
        <div hidden={tab !== 'card'}>
          <CardPane id={id} booking={booking} msLeft={msLeft} expired={expired} onConfirming={setConfirming} onHoldExpired={onHoldExpired} />
        </div>
      )}
      {wallet && (
        <WalletPayForm
          key={wallet.provider}
          booking={booking}
          wallet={wallet}
          amount={options.amount}
          currency={options.currency}
          msLeft={msLeft}
          holdEnded={holdEnded || lapsed}
          onDone={done}
        />
      )}
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
        // An expired hold with no wallet payment yet can still take a late Transaction ID.
        const late = booking.status === 'expired' && !booking.manualPayment;
        if (booking.status !== 'awaiting_payment' && !late) {
          if (live) setState({ status: 'redirect' });
          return;
        }
        const options = await apiGet<PaymentOptions>(`/bookings/${encodeURIComponent(id)}/payment-options`);
        if (!live) return;
        setState(late && options.wallets.length === 0 ? { status: 'expired', booking } : { status: 'ready', booking, options });
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
      {state.status === 'loading' && <Skeleton kind="detail" label={t('common.loading')} />}
      {state.status === 'error' && (
        <Alert tone="danger" className={styles.alert}>
          <span>{errorMessage(state.error, t)}</span>
          <Button size="sm" variant="secondary" icon="refresh" onClick={load}>
            {t('search.retry')}
          </Button>
        </Alert>
      )}
      {state.status === 'expired' && <Expired slug={state.booking?.venue?.slug ?? null} />}
      {state.status === 'ready' && <PayMethods id={id} booking={state.booking} options={state.options} />}
    </main>
  );
}
