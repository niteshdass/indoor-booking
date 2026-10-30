import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ActionMenu } from '../components/ActionMenu';
import { PROVIDER_NAMES } from '../lib/wallets';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { Skeleton } from '../components/ui/Skeleton';
import { useAuth } from '../auth/useAuth';
import { apiGet, apiPost, ApiError } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import type { BookingJson, CancellationPreview, PaymentOptions, RefundJson } from '../lib/types';
import { NotFoundPage } from '../pages/NotFoundPage';
import { SeriesBadge } from '../series/SeriesBadge';
import { MyReview } from './MyReview';
import { ReviewDialog } from './ReviewDialog';
import { BookingFacts } from './BookingFacts';
import { BookingRow } from './BookingRow';
import { CancelDialog } from './CancelDialog';
import { Receipt } from './Receipt';
import { downloadReceiptPdf } from './receiptPdf';
import { RefundList } from './RefundList';
import styles from './BookingDetailPage.module.css';

const CANCELLABLE = new Set(['awaiting_payment', 'pending', 'confirmed']);
const POLL_MS = 2000;
const POLL_BUDGET_MS = 60_000;

function DownloadGlyph() {
  return (
    <svg className={styles.glyph} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; booking: BookingJson }
  | { status: 'not_found' }
  | { status: 'error'; error: unknown };

export function BookingDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const isNew = params.get('new') === '1';
  const paid = params.get('paid') === '1';
  const lateParam = params.get('late') === '1';
  // Stripe appends redirect_status to the return URL; a declined/cancelled redirect method comes back as failed.
  const redirectStatus = params.get('redirect_status');
  const redirectFailed =
    paid &&
    redirectStatus !== null &&
    redirectStatus !== 'succeeded' &&
    redirectStatus !== 'processing';
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [refunds, setRefunds] = useState<RefundJson[]>([]);
  // The other days booked in the same go.
  const [group, setGroup] = useState<BookingJson[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  // The receipt is mounted off screen only while its PDF is being made.
  const [receipt, setReceipt] = useState<'idle' | 'busy' | 'failed'>('idle');
  const receiptRef = useRef<HTMLDivElement>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const askedForReview = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Bumped whenever the control that opened a dialog unmounts (cancel, first review, review deleted), to refocus the heading.
  const [cancelledAt, setCancelledAt] = useState(0);
  const path = `/me/bookings/${encodeURIComponent(id)}`;

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    apiGet<{ booking: BookingJson; refunds?: RefundJson[]; group?: BookingJson[] }>(path).then(
      (res) => {
        if (!live) return;
        setRefunds(res.refunds ?? []);
        setGroup(res.group ?? []);
        setState({ status: 'ready', booking: res.booking });
      },
      (error) =>
        live &&
        setState(
          error instanceof ApiError && error.status === 404
            ? { status: 'not_found' }
            : { status: 'error', error },
        ),
    );
    return () => {
      live = false;
    };
  }, [path, attempt]);

  const booking = state.status === 'ready' ? state.booking : null;
  // An expired hold whose game is still ahead can take a Transaction ID for money sent too late.
  const lastSlot = booking?.slots[booking.slots.length - 1];
  const lateEntryCandidate =
    booking?.status === 'expired' && !booking.manualPayment && !!lastSlot && Date.parse(lastSlot.endAt) > Date.now();
  const [walletsOffered, setWalletsOffered] = useState(false);
  useEffect(() => {
    setWalletsOffered(false);
    if (!lateEntryCandidate) return;
    let live = true;
    apiGet<PaymentOptions>(`/bookings/${encodeURIComponent(id)}/payment-options`).then(
      (o) => live && setWalletsOffered(o.wallets.length > 0),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [id, lateEntryCandidate]);
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

  const reference = booking?.reference;
  useEffect(() => {
    if (receipt !== 'busy' || !reference || !receiptRef.current) return;
    downloadReceiptPdf(receiptRef.current, `Receipt-${reference}.pdf`).then(
      () => setReceipt('idle'),
      (err: unknown) => {
        console.error('[receipt] PDF failed', err);
        setReceipt('failed');
      },
    );
  }, [receipt, reference]);

  useEffect(() => {
    if (cancelledAt > 0) headingRef.current?.focus();
  }, [cancelledAt]);

  const refresh = useCallback(() => {
    setSlow(false);
    setEpoch((n) => n + 1);
  }, []);

  if (state.status === 'not_found') return <NotFoundPage />;

  const holdLive = !booking?.holdExpiresAt || Date.parse(booking.holdExpiresAt) > Date.now();
  const manualPending = booking?.manualPayment?.status === 'pending';
  // A waiting payment on an expired booking was sent after its times were taken, whatever the URL says.
  const late = lateParam || (booking?.status === 'expired' && manualPending);
  const showPayNow =
    booking?.status === 'awaiting_payment' && holdLive && !manualPending && (!paid || redirectFailed || slow);
  const received =
    paid &&
    !redirectFailed &&
    !!booking &&
    (booking.status === 'pending' || booking.status === 'confirmed' || polling);
  const heading = isNew
    ? t('booking.received')
    : received
      ? t('booking.paymentReceived')
      : t('booking.title');

  const holder = booking?.guest
    ? { name: booking.guest.name, contact: booking.guest.phone }
    : user
      ? { name: user.name, contact: user.email ?? user.phone }
      : null;

  return (
    <main className={styles.page}>
      <div className={styles.titleRow}>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className={[styles.title, isNew || received ? styles.success : '']
            .filter(Boolean)
            .join(' ')}
        >
          {heading}
        </h1>
        {booking && (
          <div className={styles.titleActions}>
            {booking.amountPaid > 0 && (
              <Button
                variant="secondary"
                size="lg"
                className={styles.plain}
                loading={receipt === 'busy'}
                onClick={() => setReceipt('busy')}
              >
                <DownloadGlyph />
                {t('receipt.download')}
              </Button>
            )}
            {CANCELLABLE.has(booking.status) && (
              <ActionMenu
                label={t('booking.moreActions')}
                items={[
                  {
                    key: 'cancel',
                    label: t('cancel.open'),
                    tone: 'danger',
                    onSelect: () => setCancelOpen(true),
                  },
                ]}
              />
            )}
          </div>
        )}
      </div>
      {state.status === 'loading' && <Skeleton kind="detail" label={t('common.loading')} />}
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
          {receipt === 'failed' && (
            <Alert tone="danger" className={styles.alert}>
              <span>{t('receipt.failed')}</span>
            </Alert>
          )}
          {redirectFailed && booking.status === 'awaiting_payment' && (
            <Alert tone="danger" className={styles.alert}>
              <span>{t('payment.redirectFailed')}</span>
            </Alert>
          )}
          {booking.manualPayment && manualPending && (
            <Alert tone="info" className={styles.alert}>
              <span>
                {late
                  ? t('booking.manualLate')
                  : t('booking.manualWaiting', { provider: PROVIDER_NAMES[booking.manualPayment.provider], trxId: booking.manualPayment.trxId })}
              </span>
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
          {booking.seriesId && (
            <div className={styles.series}>
              <SeriesBadge href={`/me/bookings#series-${encodeURIComponent(booking.seriesId)}`} />
            </div>
          )}
          <BookingFacts booking={booking} />
          {group.length > 0 && (
            <section className={styles.group} aria-labelledby="booking-group-heading">
              <div className={styles.groupHead}>
                <h2 id="booking-group-heading" className={styles.groupTitle}>
                  {t('booking.groupTitle')}
                </h2>
                <p className={styles.groupNote}>
                  {t('booking.groupNote', { count: group.length + 1 })}
                </p>
              </div>
              <ul className={styles.groupList}>
                {group.map((b) => (
                  <li key={b.id}>
                    <BookingRow booking={b} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {showPayNow && (
            <Button to={`${path}/pay`} variant="brand" size="lg" block>
              {t('booking.payNow')}
            </Button>
          )}
          {lateEntryCandidate && walletsOffered && (
            <Button to={`${path}/pay`} variant="secondary" size="lg" block>
              {t('booking.lateEntry')}
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
              onDeleted={() => {
                setState({
                  status: 'ready',
                  booking: { ...booking, review: null, reviewableUntil: null },
                });
                setCancelledAt((n) => n + 1);
              }}
            />
          )}
          {(reviewable || booking.review) && (
            <ReviewDialog
              open={reviewOpen}
              onClose={() => setReviewOpen(false)}
              bookingPath={path}
              review={booking.review}
              onSaved={(review) => {
                setState({
                  status: 'ready',
                  booking: { ...booking, review, reviewableUntil: null },
                });
                setReviewOpen(false);
                if (!booking.review) setCancelledAt((n) => n + 1);
              }}
            />
          )}
          {CANCELLABLE.has(booking.status) && (
            <CancelDialog
              open={cancelOpen}
              onClose={() => setCancelOpen(false)}
              loadPreview={() =>
                apiGet<{ preview: CancellationPreview }>(`${path}/cancellation`).then(
                  (r) => r.preview,
                )
              }
              cancel={(reason) =>
                apiPost<{ booking: BookingJson; refunds: RefundJson[] }>(
                  `${path}/cancel`,
                  reason ? { reason } : {},
                )
              }
              onCancelled={(b, rs) => {
                setState({ status: 'ready', booking: b });
                setRefunds(rs);
                setCancelOpen(false);
                setCancelledAt((n) => n + 1);
              }}
            />
          )}
        </>
      )}
      {booking && receipt === 'busy' && (
        <div ref={receiptRef} className={styles.receiptStage} aria-hidden="true">
          <Receipt booking={booking} holder={holder} />
        </div>
      )}
    </main>
  );
}
