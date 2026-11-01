import { useTranslation } from 'react-i18next';
import { LogoMark } from '../components/LogoMark';
import { formatDate, formatDateTime, formatTime, money } from '../lib/format';
import { playerFee } from '../lib/platformFee';
import type { BookingJson } from '../lib/types';
import { addonLabel, amountDue } from './BookingFacts';
import styles from './Receipt.module.css';

type Props = {
  booking: BookingJson;
  /** Who booked: the signed-in player, or the guest's name and phone. */
  holder: { name: string; contact: string | null } | null;
};

/** Receipt for one booking, drawn into the downloaded PDF by the detail page. */
export function Receipt({ booking, holder }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const tz = booking.venue?.timezone ?? 'UTC';
  const fmt = (n: number) => money(n, booking.currency, lang);
  const first = booking.slots[0];
  const last = booking.slots[booking.slots.length - 1];
  const due = amountDue(booking);
  const fee = playerFee(booking.platformFee);

  return (
    <article className={styles.receipt}>
      <header className={styles.head}>
        <div className={styles.brand}>
          <LogoMark />
          <span>{t('app.name')}</span>
        </div>
        <div className={styles.titleBlock}>
          <h2 className={styles.title}>{t('receipt.title')}</h2>
          <p className={styles.reference}>{booking.reference}</p>
        </div>
      </header>

      <dl className={styles.parties}>
        {holder && (
          <div>
            <dt>{t('receipt.billedTo')}</dt>
            <dd>
              <strong>{holder.name}</strong>
              {holder.contact && <span>{holder.contact}</span>}
            </dd>
          </div>
        )}
        {booking.venue && (
          <div>
            <dt>{t('booking.venue')}</dt>
            <dd>
              <strong>{booking.venue.name}</strong>
              <span>{[booking.venue.address, booking.venue.city].filter(Boolean).join(', ')}</span>
            </dd>
          </div>
        )}
        <div>
          <dt>{t('receipt.booking')}</dt>
          <dd>
            <strong>
              {booking.turf ? `${booking.turf.name} · ` : ''}
              {formatDate(booking.businessDate, 'UTC', lang)}
            </strong>
            {first && last && (
              <span>
                {formatTime(first.startAt, tz, lang)} – {formatTime(last.endAt, tz, lang)}
                {!booking.venue && ` · ${t('booking.timesUtc')}`}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>{t('receipt.issued')}</dt>
          <dd>
            {booking.createdAt && <strong>{formatDateTime(booking.createdAt, tz, lang)}</strong>}
            <span>
              {t(`status.${booking.status}`)} · {t(`paymentStatus.${booking.paymentStatus}`)}
            </span>
          </dd>
        </div>
      </dl>

      <table className={styles.lines}>
        <thead>
          <tr>
            <th scope="col">{t('receipt.item')}</th>
            <th scope="col">{t('receipt.amount')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('checkout.subtotal')}</td>
            <td>{fmt(booking.subtotal)}</td>
          </tr>
          {booking.addons.map((a) => (
            <tr key={a.addonId}>
              <td>{addonLabel(a, t)}</td>
              <td>{fmt(a.total)}</td>
            </tr>
          ))}
          {booking.coupon && booking.coupon.discount > 0 && (
            <tr>
              <td>{t('checkout.promo.discount', { code: booking.coupon.code })}</td>
              <td>{fmt(-booking.coupon.discount)}</td>
            </tr>
          )}
          {fee > 0 && (
            <tr>
              <td>{t('checkout.platformFee')}</td>
              <td>{fmt(fee)}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className={styles.total}>
            <th scope="row">{t('booking.total')}</th>
            <td>{fmt(booking.total)}</td>
          </tr>
          <tr>
            <th scope="row">{t('booking.paid')}</th>
            <td>{fmt(booking.amountPaid)}</td>
          </tr>
          {due > 0 && (
            <tr>
              <th scope="row">{t('checkout.payLater')}</th>
              <td>{fmt(due)}</td>
            </tr>
          )}
          {booking.amountRefunded > 0 && (
            <tr>
              <th scope="row">{t('booking.refunded')}</th>
              <td>{fmt(booking.amountRefunded)}</td>
            </tr>
          )}
        </tfoot>
      </table>

      <footer className={styles.foot}>{t('receipt.thanks')}</footer>
    </article>
  );
}
