import { useTranslation } from 'react-i18next';
import styles from './Stars.module.css';

export type StarsProps = { value: number; size?: 'sm' | 'md' };

/** Five glyphs, filled to the nearest half. */
export function Stars({ value, size = 'sm' }: StarsProps) {
  const { t } = useTranslation();
  const halves = Math.round(Math.min(5, Math.max(0, value)) * 2);
  return (
    <span
      role="img"
      aria-label={t('reviews.starsLabel', { value })}
      className={[styles.stars, styles[size]].join(' ')}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = halves >= n * 2 ? styles.full : halves === n * 2 - 1 ? styles.half : '';
        return (
          <span key={n} className={styles.star} aria-hidden="true">
            ☆<span className={[styles.fill, fill].join(' ')}>★</span>
          </span>
        );
      })}
    </span>
  );
}
