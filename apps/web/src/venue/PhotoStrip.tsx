import { useTranslation } from 'react-i18next';
import type { PublicVenue } from '../lib/types';
import styles from './PhotoStrip.module.css';

export function PhotoStrip({ photos, name }: { photos: PublicVenue['photos']; name: string }) {
  const { t } = useTranslation();
  if (photos.length === 0) {
    return <div className={styles.placeholder} data-testid="photo-placeholder" aria-hidden="true" />;
  }
  return (
    <ul className={styles.strip} aria-label={t('venue.photosLabel')}>
      {photos.map((p, i) => (
        <li key={`${p.url}-${i}`} className={styles.item}>
          <img className={styles.img} src={p.url} alt={p.alt || name} loading="lazy" />
        </li>
      ))}
    </ul>
  );
}
