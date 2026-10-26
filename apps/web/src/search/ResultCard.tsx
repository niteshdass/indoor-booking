import { useId } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { SearchResult } from '@booking/shared';
import { SportCourt } from '../landing/SportCourt';
import { formatDistance, formatRating, moneyShort } from '../lib/format';
import styles from './ResultCard.module.css';

export function ResultCard({ r }: { r: SearchResult }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const slot = r.nextFreeSlot;
  const id = useId();
  return (
    <Link
      to={`/venues/${r.slug}?date=${r.date}`}
      className={styles.card}
      aria-labelledby={`${id}-name`}
      aria-describedby={`${id}-meta ${r.rating ? `${id}-rating ` : ''}${id}-price ${id}-slot`}
    >
      <span className={styles.media}>
        {r.photo ? (
          <img className={styles.photo} src={r.photo.url} alt="" loading="lazy" />
        ) : (
          <span className={styles.court} aria-hidden="true">
            <SportCourt sport={r.sports[0] ?? 'futsal'} className={styles.lines} />
          </span>
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
          {r.city}
          {r.distanceMeters !== null && (
            <>
              {' · '}
              <span className={styles.num}>{formatDistance(r.distanceMeters, lang)}</span>
            </>
          )}
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
            {slot
              ? t('search.nextFree', {
                  start: slot.localStart,
                  end: slot.localEnd,
                  turf: slot.turfName,
                })
              : t('search.noFreeSlot')}
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
