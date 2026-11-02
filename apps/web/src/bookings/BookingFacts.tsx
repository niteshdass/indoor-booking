import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AddonLine } from '@booking/shared';
import { Button } from '../components/ui/Button';
import { formatDate, formatDateTime, formatTime, money } from '../lib/format';
import { playerFee } from '../lib/platformFee';
import type { BookingJson } from '../lib/types';
import { BookingStatusBadge, PaymentStatusBadge } from './BookingStatusBadge';
import styles from './BookingFacts.module.css';

const OWING = new Set(['pending', 'confirmed']);

export function addonLabel(a: AddonLine, t: TFunction): string {
  if (a.pricingType === 'per_unit') return `${a.name} × ${a.quantity}`;
  if (a.pricingType === 'per_hour' && a.minutes)
    return `${a.name} · ${t('checkout.durationM', { minutes: a.minutes })}`;
  return a.name;
}

function CopyReference({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const available =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {available && (
        <Button size="sm" variant="secondary" icon="copy" onClick={() => void copy()}>
          {t('booking.copy')}
        </Button>
      )}
      <span className={styles.copied} aria-live="polite">
        {copied ? t('booking.copied') : ''}
      </span>
    </>
  );
}

/** What is still owed on a live booking; nothing once it is cancelled or refunded. */
export function amountDue(booking: BookingJson): number {
  return OWING.has(booking.status) && booking.amountRefunded === 0
    ? booking.total - booking.amountPaid
    : 0;
}

/** Purely presentational: shared by the signed-in detail page and the guest lookup page. */
export function BookingFacts({ booking }: { booking: BookingJson }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const tz = booking.venue?.timezone ?? 'UTC';
  const fmt = (n: number) => money(n, booking.currency, lang);
  const first = booking.slots[0];
  const last = booking.slots[booking.slots.length - 1];

  const due = amountDue(booking);
  const fee = playerFee(booking.platformFee);

  return (
    <section className={styles.facts} aria-label={t('booking.title')}>
      <header className={styles.head}>
        <div className={styles.headTop}>
          {booking.venue && (
            <h2 className={styles.venue}>
              <Link to={`/venues/${encodeURIComponent(booking.venue.slug)}`}>
                {booking.venue.name}
              </Link>
            </h2>
          )}
          <div className={styles.badges}>
            <BookingStatusBadge status={booking.status} />
            <PaymentStatusBadge status={booking.paymentStatus} />
          </div>
        </div>
        <p className={styles.meta}>
          {booking.turf && <span>{booking.turf.name}</span>}
          {booking.turf && ' · '}
          <span>{formatDate(booking.businessDate, 'UTC', lang)}</span>
          {first && last && (
            <>
              {' · '}
              <span className={styles.time}>
                {formatTime(first.startAt, tz, lang)} – {formatTime(last.endAt, tz, lang)}
              </span>
            </>
          )}
          {!booking.venue && <span className={styles.utc}> · {t('booking.timesUtc')}</span>}
        </p>
        {booking.rescheduleCount > 0 && booking.rescheduledAt && (
          <p className={styles.moved}>{t('booking.moved', { when: formatDateTime(booking.rescheduledAt, tz, lang) })}</p>
        )}
      </header>

      {booking.status === 'pending' && <p className={styles.note}>{t('booking.pendingNote')}</p>}

      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt>{t('checkout.subtotal')}</dt>
          <dd>{fmt(booking.subtotal)}</dd>
        </div>
        {booking.addons.map((a) => (
          <div className={styles.row} key={a.addonId}>
            <dt>{addonLabel(a, t)}</dt>
            <dd>{fmt(a.total)}</dd>
          </div>
        ))}
        {booking.coupon && booking.coupon.discount > 0 && (
          <div className={styles.row}>
            <dt>{t('checkout.promo.discount', { code: booking.coupon.code })}</dt>
            <dd>{fmt(-booking.coupon.discount)}</dd>
          </div>
        )}
        {fee > 0 && (
          <div className={styles.row}>
            <dt>{t('checkout.platformFee')}</dt>
            <dd>{fmt(fee)}</dd>
          </div>
        )}
        <div className={[styles.row, styles.sep].join(' ')}>
          <dt className={styles.totalLabel}>{t('booking.total')}</dt>
          <dd className={styles.total}>{fmt(booking.total)}</dd>
        </div>
        <div className={styles.row}>
          <dt>{t('booking.paid')}</dt>
          <dd>{fmt(booking.amountPaid)}</dd>
        </div>
        {due > 0 && (
          <div className={styles.row}>
            <dt>{t('checkout.payLater')}</dt>
            <dd>{fmt(due)}</dd>
          </div>
        )}
        {booking.amountRefunded > 0 && (
          <div className={styles.row}>
            <dt>{t('booking.refunded')}</dt>
            <dd>{fmt(booking.amountRefunded)}</dd>
          </div>
        )}
      </dl>

      <div className={styles.refRow}>
        <div className={styles.refBlock}>
          <span className={styles.label}>{t('booking.reference')}</span>
          <span className={styles.reference}>{booking.reference}</span>
        </div>
        <div className={styles.copy}>
          <CopyReference value={booking.reference} />
        </div>
      </div>
    </section>
  );
}
