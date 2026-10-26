import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { OwnerReviewJson, SeriesJson } from '@booking/shared';
import { formatDateTime, formatTime } from '../../lib/format';
import { NavIcon } from '../shell/NavIcon';
import type { OwnerBooking, OwnerVenue } from '../types';
import styles from './TodayPage.module.css';

type Item = { key: string; title: string; detail: string; to: string; tone: 'warning' | 'danger' | 'info'; icon: string };

/** Things on this venue someone has to act on: weekly requests, unpaid holds and low reviews without a reply. */
export function Attention({
  venue,
  bookings,
  requests,
  lowReviews,
  now = new Date(),
}: {
  venue: OwnerVenue;
  bookings: OwnerBooking[];
  requests: SeriesJson[] | null;
  lowReviews: OwnerReviewJson[] | null;
  now?: Date;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const tz = venue.timezone;

  const items: Item[] = [
    ...(requests ?? []).map((s) => ({
      key: `s${s.id}`,
      title: t('owner.today.seriesRequest', { name: s.player?.name ?? s.guest?.name ?? t('owner.today.aPlayer') }),
      detail: s.respondBy ? t('owner.today.seriesReplyBy', { time: formatDateTime(s.respondBy, tz, lang) }) : '',
      to: `series/${encodeURIComponent(s.id)}`,
      tone: 'info' as const,
      icon: 'owner.nav.series',
    })),
    ...bookings
      .filter((b) => b.status === 'awaiting_payment' && b.holdExpiresAt && Date.parse(b.holdExpiresAt) > now.getTime())
      .map((b) => ({
        key: `b${b.id}`,
        title: t('owner.today.holdExpiring', { name: b.customer?.name ?? b.reference }),
        detail: t('owner.today.holdUntil', { time: formatTime(b.holdExpiresAt!, tz, lang) }),
        to: `bookings/${encodeURIComponent(b.id)}`,
        tone: 'warning' as const,
        icon: 'clock',
      })),
    ...(lowReviews ?? []).map((r) => ({
      key: `r${r.id}`,
      title: t('owner.today.lowReview', { stars: r.stars }),
      detail: r.comment ?? t('owner.today.lowReviewHint'),
      to: `reviews?venue=${encodeURIComponent(venue.id)}&stars=${r.stars}`,
      tone: 'danger' as const,
      icon: 'owner.nav.reviews',
    })),
  ];
  if (items.length === 0) return null;

  return (
    <section className={styles.attention} aria-labelledby="today-attention">
      <h2 id="today-attention" className={styles.heading}>
        {t('owner.today.attention')}
      </h2>
      <ul className={styles.attentionList}>
        {items.map((it) => (
          <li key={it.key} className={`${styles.attentionItem} ${styles[it.tone]}`}>
            <span className={styles.attentionIcon}>
              <NavIcon navKey={it.icon} />
            </span>
            <div className={styles.attentionText}>
              <p className={styles.attentionTitle}>{it.title}</p>
              {it.detail && <p className={styles.attentionDetail}>{it.detail}</p>}
            </div>
            <Link to={it.to} className={styles.link} aria-label={`${t('owner.today.open')}: ${it.title}`}>
              {t('owner.today.open')}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
