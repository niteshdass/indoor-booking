import { useTranslation } from 'react-i18next';
import { addDays } from '@booking/shared';
import { formatDate } from '../lib/format';
import styles from './DateStrip.module.css';

export type DateStripProps = {
  today: string;
  value: string;
  onChange(d: string): void;
  days?: number;
  timeZone: string;
};

export function DateStrip({ today, value, onChange, days = 14 }: DateStripProps) {
  const { t, i18n } = useTranslation();
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i));
  if (!dates.includes(value)) dates.unshift(value);
  return (
    <div className={styles.strip} role="group" aria-label={t('venue.dateStrip')}>
      {dates.map((d) => {
        const selected = d === value;
        const isToday = d === today;
        return (
          <button
            key={d}
            type="button"
            className={[styles.chip, selected ? styles.selected : ''].filter(Boolean).join(' ')}
            aria-pressed={selected}
            aria-current={isToday ? 'date' : undefined}
            onClick={() => onChange(d)}
          >
            {isToday && <span className={styles.dot} aria-hidden="true" />}
            {formatDate(d, 'UTC', i18n.language)}
          </button>
        );
      })}
    </div>
  );
}
