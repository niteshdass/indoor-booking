import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SERIES_MAX_GAMES, MAX_SLOTS_PER_BOOKING, WEEKDAYS, type Weekday } from '@booking/shared';
import { Select } from '../components/ui/Select';
import { TextField } from '../components/ui/TextField';
import styles from './series.module.css';
import { weekdayName } from './weekdays';
import type { SeriesPattern } from './types';

export type SeriesFormProps = {
  value: SeriesPattern;
  onChange: (next: SeriesPattern) => void;
  tone: 'brand' | 'portal';
  slotTimes: string[];
  /** The turf's slot length in minutes; sizes the Length options. */
  slotMinutes: number;
};

/** Controlled weekly pattern: weekdays, start time, length, first date and how the series ends. */
export function SeriesForm({ value, onChange, tone, slotTimes, slotMinutes }: SeriesFormProps) {
  const { t, i18n } = useTranslation();
  const groupId = useId();
  // What the user is typing in the count box; null shows the pattern's count.
  const [countDraft, setCountDraft] = useState<string | null>(null);
  const mode: 'date' | 'count' = value.count !== null ? 'count' : 'date';
  const set = (patch: Partial<SeriesPattern>) => onChange({ ...value, ...patch });

  const toggle = (day: Weekday) => {
    const on = value.weekdays.includes(day);
    const next = WEEKDAYS.filter((d) => (d === day ? !on : value.weekdays.includes(d)));
    set({ weekdays: next });
  };

  const per = slotMinutes;
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
              {weekdayName(i18n.language, i)}
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
            value={countDraft ?? String(value.count ?? '')}
            onBlur={() => setCountDraft(null)}
            onChange={(e) => {
              setCountDraft(e.target.value);
              const n = Math.floor(Number(e.target.value));
              if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= 1) set({ count: Math.min(n, SERIES_MAX_GAMES) });
            }}
          />
        )}
      </fieldset>
    </div>
  );
}
