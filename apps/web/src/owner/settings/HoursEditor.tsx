import { useTranslation } from 'react-i18next';
import { WEEKDAYS, type DayHours, type Weekday, type WeeklyHours } from '@booking/shared';
import { Select } from '../../components/ui/Select';
import { TextField } from '../../components/ui/TextField';
import styles from './settings.module.css';

type Props = {
  value: Partial<WeeklyHours>;
  /** When given, each day can be set to inherit; such a day is absent from `value`. */
  inherited?: WeeklyHours;
  onChange(v: Partial<WeeklyHours>): void;
  disabled?: boolean;
};

const FALLBACK = { open: '08:00', close: '22:00' };

/** Weekday names in the active language; 2024-01-01 was a Monday. */
export function weekdayNames(lang: string): Record<Weekday, string> {
  const fmt = new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' });
  return Object.fromEntries(WEEKDAYS.map((d, i) => [d, fmt.format(new Date(Date.UTC(2024, 0, 1 + i)))])) as Record<Weekday, string>;
}

export function HoursEditor({ value, inherited, onChange, disabled }: Props) {
  const { t, i18n } = useTranslation();
  const names = weekdayNames(i18n.language);

  const setDay = (day: Weekday, next: DayHours | undefined) => {
    const out = { ...value };
    if (next === undefined) delete out[day];
    else out[day] = next;
    onChange(out);
  };

  const describe = (h: DayHours) => (h === 'closed' ? t('owner.hours.closed') : `${h.open} – ${h.close}`);

  return (
    <div className={styles.hours}>
      {WEEKDAYS.map((day) => {
        const h = value[day];
        const mode = h === undefined ? (inherited ? 'inherit' : 'open') : h === 'closed' ? 'closed' : 'open';
        const times = h && h !== 'closed' ? h : (inherited?.[day] && inherited[day] !== 'closed' ? inherited[day] : FALLBACK);
        const timesObj = times as { open: string; close: string };
        const nextDay = h !== undefined && h !== 'closed' && h.close <= h.open;
        const options = [
          { value: 'open', label: t('owner.hours.open') },
          { value: 'closed', label: t('owner.hours.closed') },
          ...(inherited ? [{ value: 'inherit', label: t('owner.hours.inherit') }] : []),
        ];
        return (
          <div key={day} className={styles.hoursRow}>
            <Select
              label={names[day]}
              value={mode}
              options={options}
              disabled={disabled}
              onChange={(e) => {
                const m = e.target.value;
                setDay(day, m === 'inherit' ? undefined : m === 'closed' ? 'closed' : { ...timesObj });
              }}
            />
            {mode === 'open' && h !== undefined && h !== 'closed' && (
              <div className={styles.times}>
                <TextField
                  label={t('owner.hours.opens')}
                  aria-label={`${t('owner.hours.opens')} ${names[day]}`}
                  type="time"
                  value={h.open}
                  disabled={disabled}
                  onChange={(e) => setDay(day, { open: e.target.value, close: h.close })}
                />
                <TextField
                  label={t('owner.hours.closes')}
                  aria-label={`${t('owner.hours.closes')} ${names[day]}`}
                  type="time"
                  value={h.close}
                  disabled={disabled}
                  onChange={(e) => setDay(day, { open: h.open, close: e.target.value })}
                />
              </div>
            )}
            {nextDay && <p className={styles.hint}>{t('owner.hours.nextDay')}</p>}
            {mode === 'inherit' && inherited && (
              <p className={styles.muted}>{t('owner.hours.inherited', { hours: describe(inherited[day]) })}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
