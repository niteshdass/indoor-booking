import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { apiGet, apiPost, ApiError } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import type { BookingJson, CancellationPreview, RefundJson } from '../lib/types';
import { NotFoundPage } from '../pages/NotFoundPage';
import { MyReview } from './MyReview';
import { ReviewDialog } from './ReviewDialog';
import { BookingFacts } from './BookingFacts';
import { CancelDialog } from './CancelDialog';
import { RefundList } from './RefundList';
import styles from './BookingDetailPage.module.css';

const CANCELLABLE = new Set(['awaiting_payment', 'pending', 'confirmed']);
const POLL_MS = 2000;
const POLL_BUDGET_MS = 60_000;

type State =
  | { status: 'loading' }
  | { status: 'ready'; booking: BookingJson }
  | { status: 'not_found' }
  | { status: 'error'; error: unknown };

export function BookingDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const isNew = params.get('new') === '1';
  const paid = params.get('paid') === '1';
  // Stripe appends redirect_status to the return URL; a declined/cancelled redirect method comes back as failed.
  const redirectStatus = params.get('redirect_status');
  const redirectFailed = paid && redirectStatus !== null && redirectStatus !== 'succeeded' && redirectStatus !== 'processing';
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [refunds, setRefunds] = useState<RefundJson[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const askedForReview = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [cancelledAt, setCancelledAt] = useState(0);
  const path = `/me/bookings/${encodeURIComponent(id)}`;

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    apiGet<{ booking: BookingJson; refunds?: RefundJson[] }>(path).then(
      (res) => {
        if (!live) return;
        setRefunds(res.refunds ?? []);
        setState({ status: 'ready', booking: res.booking });
      },
      (error) => live && setState(error instanceof ApiError && error.status === 404 ? { status: 'not_found' } : { status: 'error', error }),
    );
    return () => {
      live = false;
    };
  }, [path, attempt]);

  const booking = state.status === 'ready' ? state.booking : null;
  const reviewable = !!booking?.reviewableUntil;
  const polling = paid && !redirectFailed && booking?.status === 'awaiting_payment' && !slow;

  useEffect(() => {
    if (!polling) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const giveUp = setTimeout(() => {
      if (live) setSlow(true);
    }, POLL_BUDGET_MS);
    const tick = async () => {
      try {
        const res = await apiGet<{ booking: BookingJson }>(path);
        if (!live) return;
        setState({ status: 'ready', booking: res.booking });
        if (res.booking.status !== 'awaiting_payment') return;
      } catch {
        if (!live) return;
        // Errors are ignored until the budget ends.
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    // A fresh window after the refresh button re-checks right away.
    timer = setTimeout(() => void tick(), epoch === 0 ? POLL_MS : 0);
    return () => {
      live = false;
      clearTimeout(timer);
      clearTimeout(giveUp);
    };
  }, [polling, epoch, path]);

  // The review request notice links here with ?review=1; open the dialog once, when the booking can be reviewed.
  useEffect(() => {
    if (params.get('review') === '1' && reviewable && !askedForReview.current) {
      askedForReview.current = true;
      setReviewOpen(true);
    }
  }, [params, reviewable]);

  useEffect(() => {
    if (cancelledAt > 0) headingRef.current?.focus();
  }, [cancelledAt]);

  const refresh = useCallback(() => {
    setSlow(false);
    setEpoch((n) => n + 1);
  }, []);

  if (state.status === 'not_found') return <NotFoundPage />;

  const holdLive = !booking?.holdExpiresAt || Date.parse(booking.holdExpiresAt) > Date.now();
  const showPayNow = booking?.status === 'awaiting_payment' && holdLive && (!paid || redirectFailed || slow);
  const received =
    paid && !redirectFailed && !!booking && (booking.status === 'pending' || booking.status === 'confirmed' || polling);
  const heading = isNew ? t('booking.received') : received ? t('booking.paymentReceived') : t('booking.title');

  return (
    <main className={styles.page}>
      <h1 ref={headingRef} tabIndex={-1} className={[styles.title, isNew || received ? styles.success : ''].filter(Boolean).join(' ')}>{heading}</h1>
      {state.status === 'loading' && (
        <div className={styles.loading}>
          <Spinner label={t('common.loading')} />
        </div>
      )}
      {state.status === 'error' && (
        <Alert tone="danger" className={styles.alert}>
          <span>{errorMessage(state.error, t)}</span>
          <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            {t('search.retry')}
          </Button>
        </Alert>
      )}
      {booking && (
        <>
          {redirectFailed && booking.status === 'awaiting_payment' && (
            <Alert tone="danger" className={styles.alert}>
              <span>{t('payment.redirectFailed')}</span>
            </Alert>
          )}
          {polling && (
            <Alert tone="info" className={styles.alert}>
              <Spinner label={t('common.loading')} />
              <span>{t('booking.processing')}</span>
            </Alert>
          )}
          {paid && !redirectFailed && slow && booking.status === 'awaiting_payment' && (
            <Alert tone="warning" className={styles.alert}>
              <span>{t('booking.processingSlow')}</span>
              <Button size="sm" variant="secondary" onClick={refresh}>
                {t('booking.refresh')}
              </Button>
            </Alert>
          )}
          <BookingFacts booking={booking} />
          {showPayNow && (
            <Button to={`${path}/pay`} variant="brand" size="lg" block>
              {t('booking.payNow')}
            </Button>
          )}
          <RefundList refunds={refunds} />
          {reviewable && (
            <Button size="lg" block onClick={() => setReviewOpen(true)}>
              {t('reviews.rate')}
            </Button>
          )}
          {booking.review && (
            <MyReview
              review={booking.review}
              bookingPath={path}
              onEdit={() => setReviewOpen(true)}
              onDeleted={() => setState({ status: 'ready', booking: { ...booking, review: null, reviewableUntil: null } })}
            />
          )}
          {(reviewable || booking.review) && (
            <ReviewDialog
              open={reviewOpen}
              onClose={() => setReviewOpen(false)}
              bookingPath={path}
              review={booking.review}
              onSaved={(review) => {
                setState({ status: 'ready', booking: { ...booking, review, reviewableUntil: null } });
                setReviewOpen(false);
              }}
            />
          )}
          {CANCELLABLE.has(booking.status) && (
            <>
              <Button variant="secondary" size="lg" block onClick={() => setCancelOpen(true)}>
                {t('cancel.open')}
              </Button>
              <CancelDialog
                open={cancelOpen}
                onClose={() => setCancelOpen(false)}
                loadPreview={() => apiGet<{ preview: CancellationPreview }>(`${path}/cancellation`).then((r) => r.preview)}
                cancel={(reason) => apiPost<{ booking: BookingJson; refunds: RefundJson[] }>(`${path}/cancel`, reason ? { reason } : {})}
                onCancelled={(b, rs) => {
                  setState({ status: 'ready', booking: b });
                  setRefunds(rs);
                  setCancelOpen(false);
                  setCancelledAt((n) => n + 1);
                }}
              />
            </>
          )}
        </>
      )}
    </main>
  );
}
