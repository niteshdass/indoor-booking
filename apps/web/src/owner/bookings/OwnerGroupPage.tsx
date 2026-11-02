import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { BookingStatus } from '@booking/shared';
import { BookingStatusBadge, PaymentStatusBadge } from '../../bookings/BookingStatusBadge';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Skeleton } from '../../components/ui/Skeleton';
import { Paged } from '../../components/ui/Pagination';
import { Table } from '../../components/ui/Table';
import { ApiError, apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatTime, money } from '../../lib/format';
import { playerFee } from '../../lib/platformFee';
import { useOwner } from '../OwnerProvider';
import { customerLabel } from '../customerLabel';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import type { BookingGroup, OwnerBooking } from '../types';
import { useResource } from '../useResource';
import { OwnerRefunds } from './OwnerRefunds';
import { ReasonDialog } from './ReasonDialog';
import page from './OwnerBookingPage.module.css';
import { awaitsVerification } from './availableActions';
import styles from './OwnerGroupPage.module.css';

/** Same rules as the single booking actions. */
const CASH_STATUSES: readonly BookingStatus[] = ['pending', 'confirmed', 'completed', 'no_show'];
const CANCELLABLE: readonly BookingStatus[] = ['pending', 'awaiting_payment', 'confirmed'];

const due = (b: OwnerBooking) => (CASH_STATUSES.includes(b.status) ? Math.max(0, b.total - b.amountPaid) : 0);
const sum = (list: OwnerBooking[], f: (b: OwnerBooking) => number) => list.reduce((n, b) => n + f(b), 0);

/** Owner view of the bookings a walk-in made in one go: each booking, the combined money, and actions for all. */
export function OwnerGroupPage() {
  const { groupId = '' } = useParams();
  const { t, i18n } = useTranslation();
  const { ownerId, venues, can } = useOwner();
  const lang = i18n.language;
  useOwnerTitle(t('owner.nav.bookings'));
  const base = ownerPath(ownerId, `/booking-groups/${encodeURIComponent(groupId)}`);
  const { state, reload } = useResource<BookingGroup>(base);
  const [cashOpen, setCashOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cashError, setCashError] = useState<unknown>(null);
  const busy = useRef(false);

  const back = (
    <Link to={`/owner/${encodeURIComponent(ownerId)}/bookings`} className={page.link}>
      {t('owner.bookings.back')}
    </Link>
  );

  if (state.status === 'error') {
    const missing = state.error instanceof ApiError && state.error.status === 404;
    return (
      <div className={page.page}>
        {missing ? (
          <p className={page.muted}>{t('owner.bookings.group.notFound')}</p>
        ) : (
          <Alert tone="danger">
            <p className={page.muted}>{errorMessage(state.error, t)}</p>
            <Button variant="secondary" icon="refresh" onClick={reload}>
              {t('auth.retry')}
            </Button>
          </Alert>
        )}
        {back}
      </div>
    );
  }
  if (state.status !== 'ready') return <Skeleton kind="detail" label={t('common.loading')} />;

  const { bookings, refunds } = state.data;
  const first = bookings[0]!;
  const venue = venues.find((v) => v.id === first.venueId);
  const tz = venue?.timezone ?? 'UTC';
  const fmt = (n: number) => money(n, first.currency, lang);
  const couponCode = sum(bookings, (b) => b.coupon?.discount ?? 0) > 0 ? bookings.find((b) => b.coupon)?.coupon?.code : undefined;
  const range = (b: OwnerBooking) => {
    const s = b.slots.map((x) => x.startAt).sort();
    const e = b.slots.map((x) => x.endAt).sort();
    return s.length > 0 ? `${formatTime(s[0]!, tz, lang)} – ${formatTime(e[e.length - 1]!, tz, lang)}` : '—';
  };
  const stillDue = sum(bookings, due);
  const open = bookings.filter((b) => CANCELLABLE.includes(b.status));
  const canCash = stillDue > 0 && !bookings.some(awaitsVerification) && can('payment.mark_cash');
  const canCancel = open.length > 0 && can('booking.cancel');

  const payAll = async () => {
    if (busy.current) return;
    busy.current = true;
    setPaying(true);
    setCashError(null);
    try {
      await apiPost(`${base}/payments/cash`, {});
      setCashOpen(false);
      reload();
    } catch (e) {
      setCashError(e);
      if (e instanceof ApiError && e.status === 409) reload();
    } finally {
      busy.current = false;
      setPaying(false);
    }
  };

  return (
    <div className={page.page}>
      {back}
      <header className={page.head}>
        <h1 className={styles.title}>{t('owner.bookings.together')}</h1>
        <span className={styles.count}>{t('owner.bookings.count', { count: bookings.length })}</span>
      </header>

      {(canCash || canCancel) && (
        <div className={styles.buttons}>
          {canCash && <Button icon="money" onClick={() => { setCashError(null); setCashOpen(true); }}>{t('owner.bookings.group.cashAll')}</Button>}
          {canCancel && (
            <Button variant="secondary" icon="ban" onClick={() => setCancelOpen(true)}>
              {t('owner.bookings.group.cancelAll')}
            </Button>
          )}
        </div>
      )}

      <div className={page.layout}>
        <div className={page.main}>
          <section className={page.card} aria-label={t('owner.bookings.details')}>
            <dl className={page.facts}>
              <Fact label={t('owner.bookings.customer')}>{customerLabel(first, t)}</Fact>
              {first.customer?.phone && (
                <Fact label={t('owner.bookings.phone')}>
                  <a href={`tel:${first.customer.phone}`} className={page.link}>
                    {first.customer.phone}
                  </a>
                </Fact>
              )}
              <Fact label={t('owner.venue')}>{venue?.name ?? '—'}</Fact>
              <Fact label={t('owner.bookings.source')}>
                {first.source === 'walkin' ? t('owner.bookings.sourceWalkin') : t('owner.bookings.sourceOnline')}
              </Fact>
            </dl>
          </section>

          <section className={page.section} aria-label={t('owner.bookings.group.list')}>
            <Paged items={bookings} pageSize={10}>
              {(rows) => (
                <Table caption={t('owner.bookings.group.list')}>
                  <thead>
                    <tr>
                      <th>{t('owner.bookings.reference')}</th>
                      <th>{t('owner.bookings.turf')}</th>
                      <th>{t('owner.bookings.date')}</th>
                      <th>{t('owner.bookings.time')}</th>
                      <th>{t('owner.bookings.status')}</th>
                      <th className={page.num}>{t('owner.bookings.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <Link to={`/owner/${encodeURIComponent(ownerId)}/bookings/${encodeURIComponent(b.id)}`} className={page.link} data-row-link>
                            {b.reference}
                          </Link>
                        </td>
                        <td>{b.turf?.name ?? '—'}</td>
                        <td className={page.when}>{formatDate(b.businessDate, tz, lang)}</td>
                        <td className={page.when}>{range(b)}</td>
                        <td>
                          <div className={page.badges}>
                            <BookingStatusBadge status={b.status} toVerify={awaitsVerification(b)} />
                            {!awaitsVerification(b) && <PaymentStatusBadge status={b.paymentStatus} />}
                          </div>
                        </td>
                        <td className={page.num}>{fmt(b.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Paged>
          </section>

          <OwnerRefunds refunds={refunds} onChanged={reload} />
        </div>

        <section className={[page.card, page.summary].join(' ')} aria-label={t('owner.bookings.slots')}>
          <h2 className={page.heading}>{t('owner.bookings.slots')}</h2>
          <dl className={page.rows}>
            <Row label={t('owner.bookings.subtotal')} value={fmt(sum(bookings, (b) => b.subtotal))} />
            {sum(bookings, (b) => b.addonsTotal) > 0 && <Row label={t('owner.bookings.addons')} value={fmt(sum(bookings, (b) => b.addonsTotal))} />}
            {/* One code covers the whole group; each booking holds its share of the discount. */}
            {couponCode && <Row label={t('owner.bookings.discount', { code: couponCode })} value={fmt(-sum(bookings, (b) => b.coupon?.discount ?? 0))} />}
            {/* Player-paid fees are part of the total, so Subtotal + Add-ons + fee adds up to it. */}
            {sum(bookings, (b) => playerFee(b.platformFee)) > 0 && (
              <Row
                label={t('owner.bookings.platformFee', { payer: t('owner.bookings.feePayer.player') })}
                value={fmt(sum(bookings, (b) => playerFee(b.platformFee)))}
              />
            )}
          </dl>
          <dl className={[page.rows, page.totals].join(' ')}>
            <Row label={t('owner.bookings.total')} value={fmt(sum(bookings, (b) => b.total))} strong />
            <Row label={t('owner.bookings.paid')} value={fmt(sum(bookings, (b) => b.amountPaid))} />
            {sum(bookings, (b) => b.amountRefunded) > 0 && (
              <Row label={t('owner.bookings.refunded')} value={fmt(sum(bookings, (b) => b.amountRefunded))} />
            )}
            {stillDue > 0 && <Row label={t('owner.bookings.group.due')} value={fmt(stillDue)} />}
          </dl>
        </section>
      </div>

      <Dialog open={cashOpen} onClose={() => !busy.current && setCashOpen(false)} title={t('owner.bookings.group.cashTitle')}>
        {cashOpen && (
          <div className={styles.dialog}>
            <p className={styles.cashBody}>{t('owner.bookings.group.cashBody', { amount: fmt(stillDue) })}</p>
            {cashError !== null && <Alert tone="danger">{errorMessage(cashError, t)}</Alert>}
            <div className={styles.dialogActions}>
              <Button variant="secondary" disabled={paying} onClick={() => setCashOpen(false)}>
                {t('owner.bookings.group.back')}
              </Button>
              <Button icon="money" loading={paying} onClick={() => void payAll()}>
                {t('owner.bookings.group.cashConfirm')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      <ReasonDialog
        open={cancelOpen}
        title={t('owner.bookings.group.cancelTitle', { count: open.length })}
        description={t('owner.bookings.group.cancelBody')}
        confirmLabel={t('owner.bookings.group.cancelConfirm')}
        tone="danger"
        onClose={() => setCancelOpen(false)}
        onSubmit={async (reason) => {
          try {
            await apiPost(`${base}/cancel`, reason ? { reason } : {});
          } finally {
            // A partial cancel still changed some bookings.
            reload();
          }
          setCancelOpen(false);
        }}
      />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={page.fact}>
      <dt className={page.label}>{label}</dt>
      <dd className={page.value}>{children}</dd>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={[page.row, strong ? page.strong : ''].filter(Boolean).join(' ')}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
