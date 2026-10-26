import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays } from '@booking/shared';
import styles from './DateStrip.module.css';

export type DateStripProps = {
  today: string;
  value: string;
  onChange(d: string): void;
  days?: number;
  /** Slots picked per day; those days get a count badge. */
  marked?: Record<string, number>;
  /** Reserved: required by the interface. Labels are venue-local calendar dates formatted as UTC. */
  timeZone: string;
};

const at = (d: string) => new Date(`${d}T00:00:00Z`);

export function DateStrip({ today, value, onChange, days = 14, marked = {} }: DateStripProps) {
  const { t, i18n } = useTranslation();
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [value]);
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' });
  const dayMonth = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i));
  if (!dates.includes(value)) dates.unshift(value);
  return (
    <div className={styles.strip} role="group" aria-label={t('venue.dateStrip')}>
      {dates.map((d) => {
        const selected = d === value;
        const isToday = d === today;
        const count = marked[d] ?? 0;
        return (
          <button
            key={d}
            type="button"
            className={[styles.chip, selected ? styles.selected : ''].filter(Boolean).join(' ')}
            ref={selected ? selectedRef : undefined}
            aria-pressed={selected}
            aria-current={isToday ? 'date' : undefined}
            onClick={() => onChange(d)}
          >
            <span className={styles.weekday}>
              {isToday && <span className={styles.dot} aria-hidden="true" />}
              {isToday ? t('venue.todayChip') : weekday.format(at(d))}
            </span>
            <span className={styles.date}>{dayMonth.format(at(d))}</span>
            {count > 0 && (
              <span className={styles.badge}>
                <span aria-hidden="true">{count}</span>
                <span className={styles.hidden}>{t('slots.picked', { count })}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
