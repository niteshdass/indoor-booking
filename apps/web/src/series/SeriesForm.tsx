import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { SERIES_MAX_GAMES, MAX_SLOTS_PER_BOOKING, WEEKDAYS, type Weekday } from '@booking/shared';
import { Select } from '../components/ui/Select';
import { TextField } from '../components/ui/TextField';
import styles from './series.module.css';
import type { SeriesPattern } from './types';

export type SeriesFormProps = {
  value: SeriesPattern;
  onChange: (next: SeriesPattern) => void;
  tone: 'brand' | 'portal';
  slotTimes: string[];
};

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Minutes per slot, read from the gap between the first two start times; one hour when unknown. */
function slotMinutes(slotTimes: string[]): number {
  const gap = slotTimes.length >= 2 ? minutes(slotTimes[1]!) - minutes(slotTimes[0]!) : 0;
  return gap > 0 ? gap : 60;
}

/** Controlled weekly pattern: weekdays, start time, length, first date and how the series ends. */
export function SeriesForm({ value, onChange, tone, slotTimes }: SeriesFormProps) {
  const { t, i18n } = useTranslation();
  const groupId = useId();
  const mode: 'date' | 'count' = value.count !== null ? 'count' : 'date';
  const set = (patch: Partial<SeriesPattern>) => onChange({ ...value, ...patch });
  const dayName = (index: number) =>
    // 2024-01-01 is a Monday; index walks Mon..Sun.
    new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + index)));

  const toggle = (day: Weekday) => {
    const on = value.weekdays.includes(day);
    const next = WEEKDAYS.filter((d) => (d === day ? !on : value.weekdays.includes(d)));
    set({ weekdays: next });
  };

  const per = slotMinutes(slotTimes);
  const duration = (slots: number) => {
    const total = slots * per;
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return t('series.durationM', { m });
    return m === 0 ? t('series.durationH', { h }) : t('series.durationHM', { h, m });
  };
  const times = slotTimes.includes(value.startTime) || value.startTime === '' ? slotTimes : [value.startTime, ...slotTimes];

  return (
    <div className={styles.form}>
      <fieldset className={styles.group} aria-labelledby={`${groupId}-days`}>
        <legend id={`${groupId}-days`} className={styles.legend}>
          {t('series.weekdays')}
        </legend>
        <div className={styles.chips}>
          {WEEKDAYS.map((day, i) => (
            <button
              key={day}
              type="button"
              className={[styles.chip, tone === 'brand' ? styles.chipBrand : styles.chipPortal].join(' ')}
              aria-pressed={value.weekdays.includes(day)}
              onClick={() => toggle(day)}
            >
              {dayName(i)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className={styles.pair}>
        <Select
          layout="stacked"
          label={t('series.startTime')}
          value={value.startTime}
          options={times.map((x) => ({ value: x, label: x }))}
          onChange={(e) => set({ startTime: e.target.value })}
        />
        <Select
          layout="stacked"
          label={t('series.length')}
          value={String(value.slotCount)}
          options={Array.from({ length: MAX_SLOTS_PER_BOOKING }, (_, k) => ({ value: String(k + 1), label: duration(k + 1) }))}
          onChange={(e) => set({ slotCount: Number(e.target.value) })}
        />
      </div>
      {slotTimes.length === 0 && <p className={styles.notice}>{t('series.noSlots')}</p>}

      <TextField
        type="date"
        label={t('series.firstDate')}
        value={value.firstDate}
        onChange={(e) => set({ firstDate: e.target.value })}
      />

      <fieldset className={styles.group}>
        <legend className={styles.legend}>{t('series.ends')}</legend>
        <label className={styles.option}>
          <input
            type="radio"
            name={`${groupId}-ends`}
            checked={mode === 'date'}
            onChange={() => set({ endDate: value.endDate ?? value.firstDate, count: null })}
          />
          <span>{t('series.endsOnDate')}</span>
        </label>
        <label className={styles.option}>
          <input
            type="radio"
            name={`${groupId}-ends`}
            checked={mode === 'count'}
            onChange={() => set({ count: value.count ?? 10, endDate: null })}
          />
          <span>{t('series.endsAfter')}</span>
        </label>
        {mode === 'date' ? (
          <TextField
            type="date"
            label={t('series.endDate')}
            value={value.endDate ?? ''}
            min={value.firstDate}
            onChange={(e) => set({ endDate: e.target.value || null })}
          />
        ) : (
          <TextField
            type="number"
            inputMode="numeric"
            label={t('series.count')}
            min={1}
            max={SERIES_MAX_GAMES}
            value={value.count ?? ''}
            onChange={(e) => {
              const n = Math.floor(Number(e.target.value));
              set({ count: Number.isFinite(n) && n >= 1 ? Math.min(n, SERIES_MAX_GAMES) : 1 });
            }}
          />
        )}
      </fieldset>
    </div>
  );
}
