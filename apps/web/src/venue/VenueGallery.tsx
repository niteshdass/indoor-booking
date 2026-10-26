import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Sport } from '@booking/shared';
import { SportCourt } from '../landing/SportCourt';
import type { PublicVenue } from '../lib/types';
import styles from './VenueGallery.module.css';

/** Photos shown in the mosaic before "Show all photos" (md and up). */
const MOSAIC = 3;

type Props = { photos: PublicVenue['photos']; name: string; sport: Sport };

/**
 * Phone: a scroll-snap strip of every photo. md and up: a mosaic of the first three, expanding inline
 * (never a modal) to all of them. No photos: the venue's first sport drawn as a court.
 */
export function VenueGallery({ photos, name, sport }: Props) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);

  if (photos.length === 0) {
    return (
      <div className={styles.empty} data-testid="photo-placeholder" aria-hidden="true">
        <SportCourt sport={sport} className={styles.court} />
      </div>
    );
  }

  const more = photos.length - MOSAIC;
  return (
    <div className={styles.wrap}>
      <ul
        className={[styles.gallery, styles[`n${Math.min(photos.length, MOSAIC)}`], all && styles.all]
          .filter(Boolean)
          .join(' ')}
        aria-label={t('venue.photosLabel')}
      >
        {photos.map((p, i) => (
          <li key={`${p.url}-${i}`} className={styles.item}>
            <img className={styles.img} src={p.url} alt={p.alt || name} loading={i === 0 ? 'eager' : 'lazy'} />
          </li>
        ))}
      </ul>
      {more > 0 && (
        <button type="button" className={styles.more} aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? t('venue.fewerPhotos') : t('venue.allPhotos', { count: photos.length })}
        </button>
      )}
    </div>
  );
}
