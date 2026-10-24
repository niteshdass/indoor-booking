import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { AddonSelection } from '@booking/shared';
import { useAuth } from '../auth/useAuth';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { apiGet, apiPost, ApiError } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { money } from '../lib/format';
import type { OfferedAddonJson, PublicVenue, QuoteResponse } from '../lib/types';
import { NotFoundPage } from '../pages/NotFoundPage';
import { AddonPicker } from './AddonPicker';
import { BookingSummary } from './BookingSummary';
import { GuestForm, type GuestInput } from './GuestForm';
import { useSubmitBooking } from './useSubmitBooking';
import { readCheckout } from './checkoutParams';
import styles from './CheckoutPage.module.css';

const DEBOUNCE_MS = 250;

type VenueState = { status: 'loading' } | { status: 'ready'; venue: PublicVenue } | { status: 'not_found' } | { status: 'error'; error: unknown };
type QuoteState = { data: QuoteResponse | null; error: unknown; busy: boolean };

/** Add-on problems can be fixed in place; anything else means the slot choice must change. */
function isAddonError(err: unknown): boolean {
  return err instanceof ApiError && (err.code.startsWith('addon_') || err.code === 'invalid_quantity');
}

export function CheckoutPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const { pathname, search } = useLocation();
  const { t, i18n } = useTranslation();
  const { status: auth } = useAuth();
  const navigate = useNavigate();
  const parsed = useMemo(() => readCheckout(params), [params]);

  const [venueState, setVenueState] = useState<VenueState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [offered, setOffered] = useState<OfferedAddonJson[]>([]);
  const [selection, setSelection] = useState<AddonSelection[]>([]);
  const [quote, setQuote] = useState<QuoteState>({ data: null, error: null, busy: true });
  const quotedKey = useRef<string | null>(null);
  const [addonsFailed, setAddonsFailed] = useState(false);

  const submitter = useSubmitBooking(slug, parsed?.turfId ?? '');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [codeReset, setCodeReset] = useState(0);
  const inflight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const turfId = parsed?.turfId;
  const date = parsed?.date;
  const startKey = parsed?.startAts.join(',');

  useEffect(() => {
    if (!turfId) return;
    let live = true;
    setVenueState({ status: 'loading' });
    const base = `/venues/${encodeURIComponent(slug)}`;
    apiGet<{ venue: PublicVenue }>(base).then(
      (r) => live && setVenueState({ status: 'ready', venue: r.venue }),
      (error: unknown) => {
        if (!live) return;
        setVenueState(error instanceof ApiError && error.status === 404 ? { status: 'not_found' } : { status: 'error', error });
      },
    );
    apiGet<{ addons: OfferedAddonJson[] }>(`${base}/turfs/${encodeURIComponent(turfId)}/addons`).then(
      (r) => {
        if (!live) return;
        setOffered(r.addons);
        setAddonsFailed(false);
      },
      () => {
        if (!live) return;
        setOffered([]);
        setAddonsFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [slug, turfId, attempt]);

  // Re-quote on mount and on every selection change; the latest request wins.
  useEffect(() => {
    if (!turfId || !date || !startKey) return;
    let live = true;
    const key = `${turfId}|${date}|${startKey}`;
    setQuote((q) => ({ ...q, busy: true }));
    const body = {
      date,
      startAts: startKey.split(','),
      addons: selection.filter((s) => (s.quantity ?? 1) > 0),
    };
    const run = () =>
      apiPost<QuoteResponse>(`/venues/${encodeURIComponent(slug)}/turfs/${encodeURIComponent(turfId)}/quote`, body).then(
        (data) => {
          if (!live) return;
          quotedKey.current = key;
          setQuote({ data, error: null, busy: false });
        },
        (error: unknown) =>
          live && setQuote((q) => ({ data: isAddonError(error) ? q.data : null, error, busy: false })),
      );
    // Debounce only add-on edits; with no quote yet for this key (first mount, remount, new slots) go straight away.
    const timer = setTimeout(() => void run(), quotedKey.current === key ? DEBOUNCE_MS : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [slug, turfId, date, startKey, selection]);

  const venueHref = `/venues/${encodeURIComponent(slug)}`;

  const place = async (guest?: GuestInput) => {
    if (!parsed || inflight.current) return;
    inflight.current = true;
    setSubmitError(null);
    try {
      const booking = await submitter.submit({
        date: parsed.date,
        startAts: parsed.startAts,
        addons: selection.filter((s) => (s.quantity ?? 1) > 0),
        ...(guest ? { guest } : {}),
      });
      if (!mounted.current) return;
      if (guest) {
        navigate(`/lookup?reference=${encodeURIComponent(booking.reference)}&phone=${encodeURIComponent(guest.phone)}&new=1`);
      } else if (booking.status === 'awaiting_payment') {
        navigate(`/me/bookings/${encodeURIComponent(booking.id)}/pay`);
      } else {
        navigate(`/me/bookings/${encodeURIComponent(booking.id)}?new=1`);
      }
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof ApiError && (err.code === 'slot_taken' || err.code === 'slot_unavailable')) {
        const back = new URLSearchParams({ turf: parsed.turfId, date: parsed.date });
        navigate(`${venueHref}?${back.toString()}`, { replace: true, state: { notice: 'slot_taken' } });
        return;
      }
      if (err instanceof ApiError && (err.code === 'otp_invalid' || err.code === 'otp_expired')) setCodeReset((n) => n + 1);
      setSubmitError(errorMessage(err, t));
    } finally {
      inflight.current = false;
    }
  };

  const here = `${pathname}${search}`;
  const next = encodeURIComponent(here);

  if (!parsed) {
    return (
      <main className={styles.page}>
        <Alert tone="danger" className={styles.alert}>
          <span>{t('checkout.invalidParams')}</span>
          <Button to={venueHref} size="sm" variant="secondary">
            {t('checkout.backToVenue')}
          </Button>
        </Alert>
      </main>
    );
  }
  if (venueState.status === 'not_found') return <NotFoundPage />;
  if (venueState.status === 'loading') {
    return (
      <main className={styles.page}>
        <div className={styles.loading}>
          <Spinner label={t('common.loading')} />
        </div>
      </main>
    );
  }
  if (venueState.status === 'error') {
    return (
      <main className={styles.page}>
        <Alert tone="danger" className={styles.alert}>
          <span>{errorMessage(venueState.error, t)}</span>
          <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            {t('search.retry')}
          </Button>
        </Alert>
      </main>
    );
  }

  const { venue } = venueState;
  const turf = venue.turfs.find((x) => x.id === parsed.turfId);
  if (!turf) {
    return (
      <main className={styles.page}>
        <Alert tone="danger" className={styles.alert}>
          <span>{t('checkout.invalidParams')}</span>
          <Button to={venueHref} size="sm" variant="secondary">
            {t('checkout.backToVenue')}
          </Button>
        </Alert>
      </main>
    );
  }

  const chooseHref = `${venueHref}?${new URLSearchParams({ turf: turf.id, date: parsed.date }).toString()}`;
  const data = quote.data;
  const failed = quote.error !== null && quote.error !== undefined;
  const q = data?.quote;

  const addonErr = failed && isAddonError(quote.error);
  const submitBusy = quote.busy || submitter.pending || addonErr;

  let cta: ReactNode = null;
  if (q && data && (!failed || addonErr)) {
    if (auth === 'signedIn') {
      cta = (
        <Button
          variant="brand"
          size="lg"
          block
          disabled={submitBusy}
          aria-disabled={submitBusy}
          loading={submitter.pending}
          onClick={() => void place()}
        >
          {q.advanceRequired > 0
            ? t('checkout.bookAndPay', { amount: money(q.advanceRequired, q.currency, i18n.language) })
            : t('checkout.book')}
        </Button>
      );
    } else if (auth === 'signedOut') {
      cta = data.guestAllowed ? (
        <>
          <p className={styles.note}>{t('checkout.guestPlaceholder')}</p>
          <GuestForm
            slug={slug}
            otpRequired={data.guestOtpRequired}
            pending={submitter.pending}
            disabled={submitBusy}
            codeResetSignal={codeReset}
            label={q.advanceRequired > 0 ? t('checkout.bookAndPay', { amount: money(q.advanceRequired, q.currency, i18n.language) }) : t('checkout.book')}
            onSubmit={(g) => void place(g)}
          />
          <Button to={`/login?next=${next}`} variant="secondary" size="lg" block>
            {t('checkout.signInInstead')}
          </Button>
        </>
      ) : (
        <>
          <p className={styles.note}>{q.advanceRequired > 0 ? t('checkout.signInRequired') : t('checkout.accountRequired')}</p>
          <Button to={`/login?next=${next}`} variant="brand" size="lg" block>
            {t('checkout.signIn')}
          </Button>
          <Button to={`/register?next=${next}`} variant="secondary" size="lg" block>
            {t('checkout.createAccount')}
          </Button>
        </>
      );
    }
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t('checkout.title')}</h1>
      {failed && (
        <Alert tone="danger" className={styles.alert}>
          <span>{errorMessage(quote.error, t)}</span>
          {!isAddonError(quote.error) && (
            <Button to={chooseHref} size="sm" variant="secondary">
              {t('checkout.chooseOtherSlots')}
            </Button>
          )}
        </Alert>
      )}
      <div className={styles.layout}>
        <div className={styles.main}>
          {addonsFailed && <Alert tone="warning">{t('checkout.addonsUnavailable')}</Alert>}
          <AddonPicker
            offered={offered}
            quoteLines={q?.addons ?? []}
            value={selection}
            onChange={setSelection}
            currency={venue.currency}
          />
        </div>
        <div className={styles.side}>
          {q ? (
            <BookingSummary venue={venue} turf={turf} date={parsed.date} quote={q} busy={quote.busy}>
              {submitError && <Alert tone="danger">{submitError}</Alert>}
              {cta}
            </BookingSummary>
          ) : (
            !failed && (
              <div className={styles.loading}>
                <Spinner label={t('common.loading')} />
              </div>
            )
          )}
        </div>
      </div>
    </main>
  );
}
