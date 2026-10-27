import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Stars } from '../components/ui/Stars';
import { formatDate, formatTime, money } from '../lib/format';
import type { BookingJson } from '../lib/types';
import { SeriesBadge } from '../series/SeriesBadge';
import { BookingStatusBadge } from './BookingStatusBadge';
import styles from './MyBookingsPage.module.css';

export function BookingRow({ booking }: { booking: BookingJson }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const tz = booking.venue?.timezone ?? 'UTC';
  const starts = booking.slots.map((s) => s.startAt).sort();
  const ends = booking.slots.map((s) => s.endAt).sort();
  const first = starts[0];
  const last = ends[ends.length - 1];
  // The day tile reads the business date, which is already the venue's local day.
  const day = new Date(`${booking.businessDate}T00:00:00Z`);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lang, { ...o, timeZone: 'UTC' }).format(day);
  return (
    <Link to={`/me/bookings/${encodeURIComponent(booking.id)}`} className={styles.row}>
      <span className={styles.day} aria-label={formatDate(booking.businessDate, 'UTC', lang)}>
        <span className={styles.dayName} aria-hidden="true">{part({ weekday: 'short' })}</span>
        <span className={styles.dayNum} aria-hidden="true">{part({ day: 'numeric' })}</span>
        <span className={styles.dayName} aria-hidden="true">{part({ month: 'short' })}</span>
      </span>
      <span className={styles.body}>
        {booking.venue && <span className={styles.venue}>{booking.venue.name}</span>}
        <span className={styles.meta}>
          {booking.turf && <span>{booking.turf.name}</span>}
          {booking.turf && first && ' · '}
          {first && last && (
            <span className={styles.time}>
              {formatTime(first, tz, lang)} – {formatTime(last, tz, lang)}
              {!booking.venue && <span> · {t('booking.timesUtc')}</span>}
            </span>
          )}
        </span>
        {booking.reviewableUntil && (
          <span className={styles.cue}>
            <span aria-hidden="true">★</span> {t('reviews.rateCue')}
          </span>
        )}
        {booking.review && <Stars value={Math.round(booking.review.stars)} />}
      </span>
      <span className={styles.side}>
        <span className={styles.badges}>
          {booking.seriesId && <SeriesBadge />}
          <BookingStatusBadge status={booking.status} />
        </span>
        <span className={styles.total}>{money(booking.total, booking.currency, lang)}</span>
      </span>
    </Link>
  );
}
