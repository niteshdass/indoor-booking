import { useId } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { localParts, type SearchResult } from '@booking/shared';
import { SportCourt } from '../landing/SportCourt';
import { formatDate, formatDistance, formatRating, moneyShort } from '../lib/format';
import styles from './ResultCard.module.css';

export type ResultLayout = 'rows' | 'grid';

const ICONS = {
  pin: 'M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
};

function Icon({ d }: { d: string }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

export type ResultCardProps = {
  r: SearchResult;
  layout?: ResultLayout;
  /** Its pin on the map is highlighted. */
  active?: boolean;
  /** Pointer or focus entered (slug) or left (null) the card. */
  onActive?(slug: string | null): void;
};

export function ResultCard({ r, layout = 'rows', active = false, onActive }: ResultCardProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const id = useId();
  const place = r.address && r.address !== r.city ? `${r.address}, ${r.city}` : r.city;
  const href = `/venues/${r.slug}?date=${r.date}`;
  const more = r.freeTimeCount - r.freeTimes.length;
  const today = r.date === localParts(new Date(), r.timezone).date;
  // The card is one target through the name link stretched over it; the free times are links of their own above it.
  return (
    <article
      className={[styles.card, styles[layout], active && styles.active].filter(Boolean).join(' ')}
      onMouseEnter={() => onActive?.(r.slug)}
      onMouseLeave={() => onActive?.(null)}
      onFocus={() => onActive?.(r.slug)}
      onBlur={() => onActive?.(null)}
    >
      <span className={styles.media}>
        {r.photo ? (
          <img className={styles.photo} src={r.photo.url} alt="" loading="lazy" />
        ) : (
          <span className={styles.court} aria-hidden="true">
            <SportCourt sport={r.sports[0] ?? 'futsal'} className={styles.lines} />
          </span>
        )}
        {r.distanceMeters !== null && (
          <span className={styles.distance}>{formatDistance(r.distanceMeters, lang)}</span>
        )}
      </span>
      <span className={styles.body}>
        <span className={styles.head}>
          <Link
            to={href}
            id={`${id}-name`}
            className={styles.name}
            aria-describedby={`${id}-meta ${r.rating ? `${id}-rating ` : ''}${id}-price ${id}-slot`}
          >
            {r.name}
          </Link>
          {r.rating && (
            <span
              id={`${id}-rating`}
              role="img"
              className={styles.rating}
              aria-label={t('reviews.cardLabel', {
                value: formatRating(r.rating.average, lang),
                count: r.rating.count,
              })}
            >
              <span className={styles.star} aria-hidden="true">
                ★
              </span>{' '}
              {formatRating(r.rating.average, lang)}{' '}
              <span className={styles.ratingCount}>({r.rating.count})</span>
            </span>
          )}
        </span>
        <span id={`${id}-meta`} className={styles.meta}>
          <Icon d={ICONS.pin} />
          <span className={styles.place}>{place}</span>
        </span>
        {r.sports.length > 0 && (
          <span className={styles.sports}>
            {r.sports.map((s) => (
              <span key={s} className={styles.sport}>
                {t(`sports.${s}`)}
              </span>
            ))}
          </span>
        )}
        <span className={styles.foot}>
          {r.freeTimes.length > 0 ? (
            <span className={styles.free} role="group" aria-labelledby={`${id}-slot`}>
              <span id={`${id}-slot`} className={styles.freeLabel}>
                {today ? t('search.freeToday') : t('search.freeOn', { date: formatDate(r.date, r.timezone, lang) })}
              </span>
              <span className={styles.times}>
                {r.freeTimes.map((f) => (
                  <Link
                    key={f.startAt}
                    to={`${href}&turf=${encodeURIComponent(f.turfId)}&slot=${encodeURIComponent(f.startAt)}`}
                    className={styles.time}
                    aria-label={t('search.bookTime', { time: f.localStart, turf: f.turfName })}
                    title={f.turfName}
                  >
                    {f.localStart}
                  </Link>
                ))}
                {more > 0 && (
                  <Link to={href} className={[styles.time, styles.more].join(' ')}>
                    {t('search.moreTimes', { count: more })}
                  </Link>
                )}
              </span>
            </span>
          ) : (
            <span id={`${id}-slot`} className={styles.none}>
              <Icon d={ICONS.clock} />
              <span>{t('search.noFreeSlot')}</span>
            </span>
          )}
          <span id={`${id}-price`} className={styles.price}>
            {r.fromPrice !== null
              ? t('search.fromPrice', { price: moneyShort(r.fromPrice, r.currency, lang) })
              : t('search.noPrice')}
          </span>
        </span>
      </span>
    </article>
  );
}
