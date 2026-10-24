import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, formatTime, money } from '../lib/format';
import type { PublicTurf, PublicVenue, QuoteJson } from '../lib/types';
import styles from './BookingSummary.module.css';

type Props = { venue: PublicVenue; turf: PublicTurf; date: string; quote: QuoteJson; busy?: boolean; children?: ReactNode };

export function BookingSummary({ venue, turf, date, quote, busy = false, children }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const fmt = (n: number) => money(n, quote.currency, lang);
  const due = quote.advanceRequired;

  return (
    <section className={styles.summary} aria-label={t('checkout.summary')} aria-busy={busy || undefined}>
      <header className={styles.head}>
        <h2 className={styles.venue}>{venue.name}</h2>
        <p className={styles.meta}>
          {turf.name} · {formatDate(date, venue.timezone, lang)}
        </p>
      </header>

      <dl className={[styles.rows, busy ? styles.busy : ''].filter(Boolean).join(' ')}>
        {quote.slots.map((s) => (
          <div key={s.startAt} className={styles.row}>
            <dt>
              {formatTime(s.startAt, venue.timezone, lang)}–{formatTime(s.endAt, venue.timezone, lang)}
            </dt>
            <dd>{fmt(s.price)}</dd>
          </div>
        ))}
        {quote.addons.map((a) => (
          <div key={`${a.addonId}-${a.auto}`} className={styles.row}>
            <dt>
              {a.name} × {a.quantity}
              {a.auto && <span className={styles.auto}>{t('checkout.autoAdded')}</span>}
            </dt>
            <dd>{fmt(a.total)}</dd>
          </div>
        ))}
        <div className={[styles.row, styles.sep].join(' ')}>
          <dt>{t('checkout.subtotal')}</dt>
          <dd>{fmt(quote.subtotal)}</dd>
        </div>
        <div className={styles.row}>
          <dt>{t('checkout.addonsTotal')}</dt>
          <dd>{fmt(quote.addonsTotal)}</dd>
        </div>
        <div className={[styles.row, styles.total].join(' ')}>
          <dt>{t('checkout.total')}</dt>
          <dd>{fmt(quote.total)}</dd>
        </div>
        {due > 0 && (
          <>
            <div className={styles.row}>
              <dt>{t('checkout.advanceDue')}</dt>
              <dd>{fmt(due)}</dd>
            </div>
            <div className={styles.row}>
              <dt>{t('checkout.payLater')}</dt>
              <dd>{fmt(quote.total - due)}</dd>
            </div>
          </>
        )}
      </dl>
      {children && <div className={styles.cta}>{children}</div>}
    </section>
  );
}
