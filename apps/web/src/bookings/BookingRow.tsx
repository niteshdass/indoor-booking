import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatDate, formatTime, money } from '../lib/format';
import type { BookingJson } from '../lib/types';
import { BookingStatusBadge } from './BookingStatusBadge';
import styles from './MyBookingsPage.module.css';

export function BookingRow({ booking }: { booking: BookingJson }) {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const tz = booking.venue?.timezone ?? 'UTC';
  const starts = booking.slots.map((s) => s.startAt).sort();
  const ends = booking.slots.map((s) => s.endAt).sort();
  const first = starts[0];
  const last = ends[ends.length - 1];
  return (
    <Link to={`/me/bookings/${encodeURIComponent(booking.id)}`} className={styles.row}>
      <span className={styles.top}>
        <span className={styles.venue}>{booking.venue?.name}</span>
        <BookingStatusBadge status={booking.status} />
      </span>
      <span className={styles.meta}>
        {booking.turf && <span>{booking.turf.name}</span>}
        {booking.turf && ' · '}
        <span>{formatDate(booking.businessDate, 'UTC', lang)}</span>
      </span>
      <span className={styles.bottom}>
        {first && last && (
          <span className={styles.time}>
            {formatTime(first, tz, lang)} – {formatTime(last, tz, lang)}
          </span>
        )}
        <span className={styles.total}>{money(booking.total, booking.currency, lang)}</span>
      </span>
    </Link>
  );
}
