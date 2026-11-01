import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { OwnerReviewJson, SeriesJson } from '@booking/shared';
import { formatDateTime, formatTime, money } from '../../lib/format';
import { RowActions } from '../bookings/BookingActions';
import { availableActions, awaitsVerification, type Action } from '../bookings/availableActions';
import { useOwner } from '../OwnerProvider';
import { NavIcon } from '../shell/NavIcon';
import type { OwnerBooking, OwnerVenue } from '../types';
import { SOON_MS } from './nextStep';
import { useKeepWhileOpen } from './useKeepWhileOpen';
import styles from './TodayPage.module.css';

type Item = {
  key: string;
  title: string;
  detail: string;
  to: string;
  tone: 'warning' | 'danger' | 'info';
  icon: string;
  /** With a booking and its primary action the row acts inline; without a permitted action it falls back to Open. */
  booking?: OwnerBooking;
  primary?: Action;
  /** A secondary link under the text, e.g. to every booking the row counts. */
  more?: { to: string; label: string };
};

/** A confirmed game this long past its start without a check-in needs chasing. */
const LATE_MS = 15 * 60_000;

/** A game this close to starting makes an unchecked payment urgent. */
const VERIFY_URGENT_MS = 60 * 60_000;

const startOf = (b: OwnerBooking) => Math.min(...b.slots.map((s) => Date.parse(s.startAt)));
const endOf = (b: OwnerBooking) => Math.max(...b.slots.map((s) => Date.parse(s.endAt)));

/**
 * Things on this venue someone has to act on: bookings waiting for confirmation, games starting soon that still owe,
 * started games nobody checked in, weekly requests, unpaid holds and low reviews without a reply.
 */
export function Attention({
  venue,
  bookings,
  toVerifyAll = null,
  requests,
  lowReviews,
  onChanged,
  now = new Date(),
}: {
  venue: OwnerVenue;
  bookings: OwnerBooking[];
  /** Wallet payments to check on any date: how many, and the soonest game; null while loading or on failure. */
  toVerifyAll?: { total: number; first: OwnerBooking | null } | null;
  requests: SeriesJson[] | null;
  lowReviews: OwnerReviewJson[] | null;
  onChanged(): void;
  now?: Date;
}) {
  const { t, i18n } = useTranslation();
  const { can } = useOwner();
  const { keep, opened } = useKeepWhileOpen<Item>((it) => it.key);
  const lang = i18n.language;
  const tz = venue.timezone;
  const at = now.getTime();
  const nameOf = (b: OwnerBooking) => b.customer?.name ?? b.reference;
  const bookingTo = (b: OwnerBooking) => `../bookings/${encodeURIComponent(b.id)}`;

  const submittedAt = (b: OwnerBooking) => Date.parse(b.manualPayment?.submittedAt ?? b.createdAt);
  const toVerify = bookings.filter(awaitsVerification);
  const oldestVerify = toVerify.reduce<OwnerBooking | null>((o, b) => (o === null || submittedAt(b) < submittedAt(o) ? b : o), null);
  // Today's oldest stays the one to act on; with none today, the soonest game on another date.
  const verifyCount = Math.max(toVerify.length, toVerifyAll?.total ?? 0);
  const verifyNext = oldestVerify ?? (verifyCount > 0 ? (toVerifyAll?.first ?? null) : null);
  // Bookings in the "payments to verify" row are not also counted as waiting for confirmation.
  const pending = bookings.filter((b) => b.status === 'pending' && !awaitsVerification(b));
  const oldest = pending.reduce<OwnerBooking | null>((o, b) => (o === null || Date.parse(b.createdAt) < Date.parse(o.createdAt) ? b : o), null);
  const confirmed = bookings.filter((b) => b.status === 'confirmed');

  const items = keep([
    ...(verifyNext
      ? [
          {
            key: `verify${verifyNext.id}`,
            title: t('owner.today.paymentsToVerify', { count: verifyCount }),
            detail: oldestVerify
              ? t('owner.today.verifyOldest', {
                  name: nameOf(oldestVerify),
                  time: formatTime(new Date(submittedAt(oldestVerify)).toISOString(), tz, lang),
                })
              : t('owner.today.verifySoonest', {
                  name: nameOf(verifyNext),
                  time: formatDateTime(new Date(startOf(verifyNext)).toISOString(), tz, lang),
                }),
            to: bookingTo(verifyNext),
            tone: startOf(verifyNext) <= at + VERIFY_URGENT_MS ? ('danger' as const) : ('warning' as const),
            icon: 'clock',
            booking: verifyNext,
            primary: 'verify' as const,
            more: { to: `../bookings?tab=to_verify&venue=${encodeURIComponent(venue.id)}`, label: t('owner.today.verifyAll') },
          },
        ]
      : []),
    ...(oldest
      ? [
          {
            key: `pending${oldest.id}`,
            title: t('owner.today.pendingCount', { count: pending.length }),
            detail: t('owner.today.pendingOldest', { name: nameOf(oldest), time: formatTime(new Date(startOf(oldest)).toISOString(), tz, lang) }),
            to: bookingTo(oldest),
            tone: 'warning' as const,
            icon: 'clock',
            booking: oldest,
            primary: 'confirm' as const,
          },
        ]
      : []),
    ...confirmed
      .filter((b) => b.total - b.amountPaid > 0 && startOf(b) > at && startOf(b) <= at + SOON_MS)
      .map((b) => ({
        key: `due${b.id}`,
        title: t('owner.today.dueSoon', {
          name: nameOf(b),
          time: formatTime(new Date(startOf(b)).toISOString(), tz, lang),
          due: money(b.total - b.amountPaid, venue.currency, lang),
        }),
        detail: '',
        to: bookingTo(b),
        tone: 'warning' as const,
        icon: 'clock',
        booking: b,
        primary: 'markCash' as const,
      })),
    ...confirmed
      .filter((b) => startOf(b) < at - LATE_MS && endOf(b) > at)
      .map((b) => ({
        key: `late${b.id}`,
        title: t('owner.today.notCheckedIn', { name: nameOf(b), time: formatTime(new Date(startOf(b)).toISOString(), tz, lang) }),
        detail: '',
        to: bookingTo(b),
        tone: 'danger' as const,
        icon: 'clock',
        booking: b,
        primary: 'checkIn' as const,
      })),
    ...(requests ?? []).map((s) => ({
      key: `s${s.id}`,
      title: t('owner.today.seriesRequest', { name: s.player?.name ?? s.guest?.name ?? t('owner.today.aPlayer') }),
      detail: s.respondBy ? t('owner.today.seriesReplyBy', { time: formatDateTime(s.respondBy, tz, lang) }) : '',
      to: `../series/${encodeURIComponent(s.id)}`,
      tone: 'info' as const,
      icon: 'owner.nav.series',
    })),
    ...bookings
      .filter((b) => b.status === 'awaiting_payment' && b.holdExpiresAt && Date.parse(b.holdExpiresAt) > now.getTime())
      .map((b) => ({
        key: `b${b.id}`,
        title: t('owner.today.holdExpiring', { name: b.customer?.name ?? b.reference }),
        detail: t('owner.today.holdUntil', { time: formatTime(b.holdExpiresAt!, tz, lang) }),
        to: `../bookings/${encodeURIComponent(b.id)}`,
        tone: 'warning' as const,
        icon: 'clock',
      })),
    ...(lowReviews ?? []).map((r) => ({
      key: `r${r.id}`,
      title: t('owner.today.lowReview', { stars: r.stars }),
      detail: r.comment ?? t('owner.today.lowReviewHint'),
      to: `../reviews?venue=${encodeURIComponent(venue.id)}&stars=${r.stars}`,
      tone: 'danger' as const,
      icon: 'owner.nav.reviews',
    })),
  ]);
  if (items.length === 0) return null;

  return (
    <section className={`${styles.panel} ${styles.attention}`} aria-labelledby="today-attention">
      <div className={styles.panelHead}>
        <h2 id="today-attention" className={styles.heading}>
          {t('owner.today.attention')}
        </h2>
        <span className={styles.count}>{items.length}</span>
      </div>
      <ul className={styles.attentionList}>
        {items.map((it) => (
          <li key={it.key} className={`${styles.attentionItem} ${styles[it.tone]}`}>
            <span className={styles.attentionIcon}>
              <NavIcon navKey={it.icon} />
            </span>
            <div className={styles.attentionText}>
              <p className={styles.attentionTitle}>{it.title}</p>
              {it.detail && <p className={styles.attentionDetail}>{it.detail}</p>}
              {it.more && (
                <Link to={it.more.to} className={`${styles.link} ${styles.attentionMore}`} aria-label={`${it.more.label}: ${it.title}`}>
                  {it.more.label}
                </Link>
              )}
            </div>
            {it.booking && it.primary && availableActions(it.booking, can).length > 0 ? (
              <div className={styles.attentionActions}>
                <RowActions
                  booking={it.booking}
                  primary={it.primary}
                  onDone={onChanged}
                  onOpenChange={(open) => opened(it.key, open)}
                />
              </div>
            ) : (
              <Link to={it.to} className={styles.link} aria-label={`${t('owner.today.open')}: ${it.title}`}>
                {t('owner.today.open')}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
