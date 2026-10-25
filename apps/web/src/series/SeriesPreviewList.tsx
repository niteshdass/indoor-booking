import { useTranslation } from 'react-i18next';
import { Badge } from '../components/ui/Badge';
import { formatDate, formatTime, money } from '../lib/format';
import styles from './series.module.css';
import type { SeriesPreview } from './types';

/** One row per candidate date: the price when it is free, else why it is skipped; then the totals. */
export function SeriesPreviewList({ preview, timeZone }: { preview: SeriesPreview; timeZone: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const skipped = preview.dates.length - preview.freeCount;
  return (
    <div>
      <ul className={styles.list} aria-label={t('series.previewLabel')}>
        {preview.dates.map((d) =>
          d.status === 'free' ? (
            <li key={d.date} className={styles.item}>
              <span className={styles.when}>
                {formatDate(d.date, timeZone, lang)}, {formatTime(d.startAt, timeZone, lang)}–{formatTime(d.endAt, timeZone, lang)}
              </span>
              <span className={styles.price}>{money(d.price, preview.currency, lang)}</span>
            </li>
          ) : (
            <li key={d.date} className={styles.item}>
              <span className={styles.when}>{formatDate(d.date, timeZone, lang)}</span>
              <Badge tone="warning">{t(`series.reason.${d.reason}`)}</Badge>
            </li>
          ),
        )}
      </ul>
      <p className={styles.footer}>
        <span>{t('series.footer', { count: preview.freeCount, total: money(preview.total, preview.currency, lang) })}</span>
        {skipped > 0 && <span className={styles.skipped}>{t('series.skipped', { count: skipped })}</span>}
      </p>
    </div>
  );
}
