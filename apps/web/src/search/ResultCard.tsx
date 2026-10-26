import { useId } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { SearchResult } from '@booking/shared';
import { SportCourt } from '../landing/SportCourt';
import { formatDistance, formatRating, moneyShort } from '../lib/format';
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
  const slot = r.nextFreeSlot;
  const id = useId();
  const place = r.address && r.address !== r.city ? `${r.address}, ${r.city}` : r.city;
  return (
    <Link
      to={`/venues/${r.slug}?date=${r.date}`}
      className={[styles.card, styles[layout], active && styles.active].filter(Boolean).join(' ')}
      aria-labelledby={`${id}-name`}
      aria-describedby={`${id}-meta ${r.rating ? `${id}-rating ` : ''}${id}-price ${id}-slot`}
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
          <span id={`${id}-name`} className={styles.name}>
            {r.name}
          </span>
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
          <span
            id={`${id}-slot`}
            className={[styles.slot, slot && styles.free].filter(Boolean).join(' ')}
          >
            <Icon d={ICONS.clock} />
            <span>
              {slot
                ? t('search.nextFree', {
                    start: slot.localStart,
                    end: slot.localEnd,
                    turf: slot.turfName,
                  })
                : t('search.noFreeSlot')}
            </span>
          </span>
          <span id={`${id}-price`} className={styles.price}>
            {r.fromPrice !== null
              ? t('search.fromPrice', { price: moneyShort(r.fromPrice, r.currency, lang) })
              : t('search.noPrice')}
          </span>
        </span>
      </span>
    </Link>
  );
}
