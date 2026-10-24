import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AddonLine } from '@booking/shared';
import { Button } from '../components/ui/Button';
import { formatDate, formatTime, money } from '../lib/format';
import type { BookingJson } from '../lib/types';
import { BookingStatusBadge, PaymentStatusBadge } from './BookingStatusBadge';
import styles from './BookingFacts.module.css';

function addonLabel(a: AddonLine, t: TFunction): string {
  if (a.pricingType === 'per_unit') return `${a.name} × ${a.quantity}`;
  if (a.pricingType === 'per_hour' && a.minutes) return `${a.name} · ${t('checkout.durationM', { minutes: a.minutes })}`;
  return a.name;
}

function CopyReference({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const available = typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';

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
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          {t('booking.copy')}
        </Button>
      )}
      <span className={styles.copied} aria-live="polite">
        {copied ? t('booking.copied') : ''}
      </span>
    </>
  );
}

/** Purely presentational: shared by the signed-in detail page and the guest lookup page. */
export function BookingFacts({ booking }: { booking: BookingJson }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const tz = booking.venue?.timezone ?? 'UTC';
  const fmt = (n: number) => money(n, booking.currency, lang);
  const first = booking.slots[0];
  const last = booking.slots[booking.slots.length - 1];

  return (
    <section className={styles.facts} aria-label={t('booking.title')}>
      <div className={styles.refRow}>
        <div className={styles.refBlock}>
          <span className={styles.label}>{t('booking.reference')}</span>
          <span className={styles.reference}>{booking.reference}</span>
        </div>
        <CopyReference value={booking.reference} />
      </div>

      <div className={styles.badges}>
        <BookingStatusBadge status={booking.status} />
        <PaymentStatusBadge status={booking.paymentStatus} />
      </div>

      {booking.status === 'pending' && <p className={styles.note}>{t('booking.pendingNote')}</p>}

      <header className={styles.head}>
        <h2 className={styles.venue}>
          {booking.venue ? <Link to={`/venues/${encodeURIComponent(booking.venue.slug)}`}>{booking.venue.name}</Link> : null}
        </h2>
        <p className={styles.meta}>
          {booking.turf && <span>{booking.turf.name}</span>}
          {booking.turf && ' · '}
          <span>{formatDate(booking.businessDate, 'UTC', lang)}</span>
        </p>
        {first && last && (
          <p className={styles.time}>
            {formatTime(first.startAt, tz, lang)} – {formatTime(last.endAt, tz, lang)}
          </p>
        )}
      </header>

      <dl className={styles.rows}>
        {booking.addons.map((a) => (
          <div className={styles.row} key={a.addonId}>
            <dt>{addonLabel(a, t)}</dt>
            <dd>{fmt(a.total)}</dd>
          </div>
        ))}
        <div className={[styles.row, styles.sep].join(' ')}>
          <dt className={styles.totalLabel}>{t('booking.total')}</dt>
          <dd className={styles.total}>{fmt(booking.total)}</dd>
        </div>
        <div className={styles.row}>
          <dt>{t('booking.paid')}</dt>
          <dd>{fmt(booking.amountPaid)}</dd>
        </div>
        {booking.amountRefunded > 0 && (
          <div className={styles.row}>
            <dt>{t('booking.refunded')}</dt>
            <dd>{fmt(booking.amountRefunded)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
