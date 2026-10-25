import { useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AddonLine } from '@booking/shared';
import { BookingStatusBadge, PaymentStatusBadge } from '../../bookings/BookingStatusBadge';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { Table } from '../../components/ui/Table';
import { SeriesBadge } from '../../series/SeriesBadge';
import { ApiError } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatTime, money } from '../../lib/format';
import { useOwner } from '../OwnerProvider';
import { customerLabel } from '../customerLabel';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import type { BookingDetail, PaymentJson, RefundJson } from '../types';
import { useResource } from '../useResource';
import { BookingActions } from './BookingActions';
import { OwnerRefunds } from './OwnerRefunds';
import styles from './OwnerBookingPage.module.css';

function addonLabel(a: AddonLine, t: TFunction): string {
  if (a.pricingType === 'per_unit') return `${a.name} × ${a.quantity}`;
  if (a.pricingType === 'per_hour' && a.minutes) return `${a.name} · ${t('checkout.durationM', { minutes: a.minutes })}`;
  return a.name;
}

const PAYMENT_TONE = { succeeded: 'success', pending: 'warning', failed: 'danger' } as const;

/** Owner view of one booking: facts, money, payments and the status actions. */
export function OwnerBookingPage() {
  const { bookingId = '' } = useParams();
  const { t, i18n } = useTranslation();
  const { ownerId, venues } = useOwner();
  const lang = i18n.language;
  useOwnerTitle(t('owner.nav.bookings'));
  const { state, reload, set } = useResource<BookingDetail>(ownerPath(ownerId, `/bookings/${encodeURIComponent(bookingId)}`));

  const data = state.status === 'ready' ? state.data : null;
  const updated = useCallback(
    (booking: BookingDetail['booking']) => {
      if (data) set({ ...data, booking });
    },
    [data, set],
  );
  const paid = useCallback(
    (booking: BookingDetail['booking']) => {
      updated(booking);
      reload();
    },
    [updated, reload],
  );
  const cancelled = useCallback(
    (booking: BookingDetail['booking'], refunds: RefundJson[]) => {
      if (data) {
        const known = new Set(refunds.map((r) => r.id));
        set({ ...data, booking, refunds: [...data.refunds.filter((r) => !known.has(r.id)), ...refunds] });
      }
      reload();
    },
    [data, set, reload],
  );

  const back = (
    <Link to={`/owner/${encodeURIComponent(ownerId)}/bookings`} className={styles.link}>
      {t('owner.bookings.back')}
    </Link>
  );

  if (state.status === 'error') {
    if (state.error instanceof ApiError && state.error.status === 404) {
      return (
        <div className={styles.page}>
          <p className={styles.muted}>{t('owner.bookings.notFound')}</p>
          {back}
        </div>
      );
    }
    return (
      <div className={styles.page}>
        <Alert tone="danger">
          <p className={styles.muted}>{errorMessage(state.error, t)}</p>
          <Button variant="secondary" onClick={reload}>
            {t('auth.retry')}
          </Button>
        </Alert>
        {back}
      </div>
    );
  }
  if (!data) return <Spinner label={t('common.loading')} />;

  const { booking: b, payments, refunds } = data;
  const venue = venues.find((v) => v.id === b.venueId);
  const tz = venue?.timezone ?? 'UTC';
  const fmt = (n: number) => money(n, b.currency, lang);
  const starts = b.slots.map((s) => s.startAt).sort();
  const ends = b.slots.map((s) => s.endAt).sort();
  const range = (a: string, z: string) => `${formatTime(a, tz, lang)} – ${formatTime(z, tz, lang)}`;
  const customerName = customerLabel(b, t);

  return (
    <div className={styles.page}>
      {back}
      <header className={styles.head}>
        <h1 className={styles.reference}>{b.reference}</h1>
        <div className={styles.badges}>
          <BookingStatusBadge status={b.status} />
          <PaymentStatusBadge status={b.paymentStatus} />
          {b.seriesId && <SeriesBadge href={`/owner/${encodeURIComponent(ownerId)}/series/${encodeURIComponent(b.seriesId)}`} />}
        </div>
      </header>

      <BookingActions
        booking={b}
        onUpdated={updated}
        onPaid={paid}
        onCancelled={cancelled}
        onConflict={reload}
      />

      <section className={styles.card} aria-label={t('owner.bookings.details')}>
        <dl className={styles.facts}>
          <Fact label={t('owner.venue')}>{venue?.name ?? '—'}</Fact>
          <Fact label={t('owner.bookings.turf')}>{b.turf?.name ?? '—'}</Fact>
          <Fact label={t('owner.bookings.date')}>{formatDate(b.businessDate, tz, lang)}</Fact>
          <Fact label={t('owner.bookings.time')}>
            {starts.length > 0 ? range(starts[0]!, ends[ends.length - 1]!) : '—'}
          </Fact>
          <Fact label={t('owner.bookings.source')}>
            {b.source === 'walkin' ? t('owner.bookings.sourceWalkin') : t('owner.bookings.sourceOnline')}
          </Fact>
          <Fact label={t('owner.bookings.customer')}>{customerName}</Fact>
          {b.customer?.phone && (
            <Fact label={t('owner.bookings.phone')}>
              <a href={`tel:${b.customer.phone}`} className={styles.link}>
                {b.customer.phone}
              </a>
            </Fact>
          )}
          {b.customer?.email && <Fact label={t('owner.bookings.email')}>{b.customer.email}</Fact>}
          {b.rejectReason && <Fact label={t('owner.bookings.reason.recorded')}>{b.rejectReason}</Fact>}
          {b.cancelReason && <Fact label={t('owner.bookings.reason.recorded')}>{b.cancelReason}</Fact>}
        </dl>
      </section>

      <section className={styles.card} aria-label={t('owner.bookings.slots')}>
        <h2 className={styles.heading}>{t('owner.bookings.slots')}</h2>
        <dl className={styles.rows}>
          {b.slots.map((s) => (
            <div className={styles.row} key={s.startAt}>
              <dt>{range(s.startAt, s.endAt)}</dt>
              <dd>{fmt(s.price)}</dd>
            </div>
          ))}
          {b.addons.map((a) => (
            <div className={styles.row} key={a.addonId}>
              <dt>{addonLabel(a, t)}</dt>
              <dd>{fmt(a.total)}</dd>
            </div>
          ))}
        </dl>
        <dl className={[styles.rows, styles.totals].join(' ')}>
          <Row label={t('owner.bookings.subtotal')} value={fmt(b.subtotal)} />
          {b.addonsTotal > 0 && <Row label={t('owner.bookings.addons')} value={fmt(b.addonsTotal)} />}
          <Row label={t('owner.bookings.total')} value={fmt(b.total)} strong />
          {b.advanceRequired > 0 && <Row label={t('owner.bookings.advance')} value={fmt(b.advanceRequired)} />}
          <Row label={t('owner.bookings.paid')} value={fmt(b.amountPaid)} />
          {b.amountRefunded > 0 && <Row label={t('owner.bookings.refunded')} value={fmt(b.amountRefunded)} />}
        </dl>
      </section>

      <section className={styles.section} aria-label={t('owner.bookings.payments')}>
        <h2 className={styles.heading}>{t('owner.bookings.payments')}</h2>
        {payments.length === 0 ? (
          <p className={styles.muted}>{t('owner.bookings.noPayments')}</p>
        ) : (
          <Table caption={t('owner.bookings.payments')}>
            <thead>
              <tr>
                <th>{t('owner.bookings.payMethod')}</th>
                <th>{t('owner.bookings.payAmount')}</th>
                <th>{t('owner.bookings.status')}</th>
                <th>{t('owner.bookings.payWhen')}</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p: PaymentJson) => (
                <tr key={p.id}>
                  <td>{t(`cancel.method.${p.method}`)}</td>
                  <td>{money(p.amount, p.currency, lang)}</td>
                  <td>
                    <Badge tone={PAYMENT_TONE[p.status]}>{t(`owner.bookings.payStatus.${p.status}`)}</Badge>
                  </td>
                  <td>
                    {formatDate(p.createdAt, tz, lang)} {formatTime(p.createdAt, tz, lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <OwnerRefunds refunds={refunds} onChanged={reload} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{children}</dd>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={[styles.row, strong ? styles.strong : ''].filter(Boolean).join(' ')}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
