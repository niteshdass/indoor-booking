import { useId } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { SearchResult } from '@booking/shared';
import { Badge } from '../components/ui/Badge';
import { formatDistance, money } from '../lib/format';
import styles from './ResultCard.module.css';

export function ResultCard({ r }: { r: SearchResult }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const slot = r.nextFreeSlot;
  const id = useId();
  return (
    <Link to={`/venues/${r.slug}?date=${r.date}`} className={styles.card} aria-labelledby={`${id}-name`} aria-describedby={`${id}-meta ${id}-price ${id}-slot`}>
      {r.photo ? (
        <img className={styles.photo} src={r.photo.url} alt="" loading="lazy" />
      ) : (
        <span className={styles.placeholder} aria-hidden="true" />
      )}
      <span className={styles.body}>
        <span id={`${id}-name`} className={styles.name}>{r.name}</span>
        <span id={`${id}-meta`} className={styles.meta}>
          {r.city}
          {r.distanceMeters !== null && <> · <span className={styles.num}>{formatDistance(r.distanceMeters, lang)}</span></>}
        </span>
        {r.sports.length > 0 && (
          <span className={styles.sports}>
            {r.sports.map((s) => (
              <Badge key={s} tone="neutral">
                {t(`sports.${s}`)}
              </Badge>
            ))}
          </span>
        )}
        <span id={`${id}-price`} className={styles.price}>
          {r.fromPrice !== null ? t('search.fromPrice', { price: money(r.fromPrice, r.currency, lang) }) : t('search.noPrice')}
        </span>
        <span id={`${id}-slot`} className={styles.slot}>
          {slot
            ? t('search.nextFree', { start: slot.localStart, end: slot.localEnd, turf: slot.turfName })
            : t('search.noFreeSlot')}
        </span>
      </span>
    </Link>
  );
}
