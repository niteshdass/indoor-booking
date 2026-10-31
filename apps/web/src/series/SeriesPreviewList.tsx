import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../components/ui/Badge';
import { formatDate, formatTime, money } from '../lib/format';
import styles from './series.module.css';
import type { SeriesPreview } from './types';

/** Rows shown before the list collapses behind "Show all". */
const COLLAPSED_ROWS = 5;

/** One row per candidate date: the price when it is free, else why it is skipped; then the totals (with any player-paid fee named) and an optional action. */
export function SeriesPreviewList({ preview, timeZone, action }: { preview: SeriesPreview; timeZone: string; action?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [expanded, setExpanded] = useState(false);
  const skipped = preview.dates.length - preview.freeCount;
  // Keep one extra row rather than a "Show all" that reveals a single date.
  const collapsible = preview.dates.length > COLLAPSED_ROWS + 1;
  const dates = collapsible && !expanded ? preview.dates.slice(0, COLLAPSED_ROWS) : preview.dates;
  // A player-paid fee is already in `total`; it is named, never added again.
  const fee = preview.platformFee?.payer === 'player' ? preview.platformFee.perGame.reduce((n, x) => n + x, 0) : 0;
  return (
    <div className={styles.group}>
      <ul className={styles.list} aria-label={t('series.previewLabel')}>
        {dates.map((d) =>
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
      {collapsible && (
        <button type="button" className={styles.more} aria-expanded={expanded} onClick={() => setExpanded((x) => !x)}>
          {expanded ? t('series.showFewer') : t('series.showAll', { count: preview.dates.length })}
        </button>
      )}
      <div className={styles.footer}>
        <p className={styles.totals}>
          <span className={styles.total}>{t('series.footer', { count: preview.freeCount, total: money(preview.total, preview.currency, lang) })}</span>
          {fee > 0 && <span className={styles.skipped}>{t('series.feeIncluded', { amount: money(fee, preview.currency, lang) })}</span>}
          {skipped > 0 && <span className={styles.skipped}>{t('series.skipped', { count: skipped })}</span>}
        </p>
        {action}
      </div>
    </div>
  );
}
