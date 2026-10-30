import { useTranslation } from 'react-i18next';
import { formatDate, formatTime } from '../lib/format';
import type { BookingJson } from '../lib/types';
import styles from './PayPage.module.css';

/** The hold pill turns to warning for the last minute. */
const HOLD_WARN_MS = 60_000;

export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** The hold countdown, shared by every payment tab. */
export function HoldPill({ msLeft }: { msLeft: number }) {
  const { t } = useTranslation();
  return (
    <p className={[styles.hold, msLeft < HOLD_WARN_MS ? styles.holdEnding : ''].filter(Boolean).join(' ')} aria-live="off">
      {t('payment.holdEndsIn', { time: formatClock(msLeft) })}
    </p>
  );
}

/** "Arena One · Court 1 · Tue, Oct 27 · 13:00 – 15:00"; one payment for several bookings names only the venue and court. */
export function BookingLine({ booking }: { booking: BookingJson }) {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const tz = booking.venue?.timezone ?? 'UTC';
  const first = booking.slots[0];
  const last = booking.slots[booking.slots.length - 1];
  const parts = [booking.venue?.name, booking.turf?.name];
  if (!booking.groupId) {
    parts.push(formatDate(booking.businessDate, 'UTC', lang));
    if (first && last) parts.push(`${formatTime(first.startAt, tz, lang)} – ${formatTime(last.endAt, tz, lang)}`);
  }
  const text = parts.filter(Boolean).join(' · ');
  return text ? <p className={styles.meta}>{text}</p> : null;
}
