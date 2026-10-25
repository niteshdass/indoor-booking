import { useTranslation } from 'react-i18next';
import { money } from '../lib/format';
import type { SlotDay, SlotJson } from '../lib/types';
import styles from './SlotGrid.module.css';

type Props = { day: SlotDay; selected: string[]; onToggle(startAt: string): void; /** `portal` paints the selection with primary instead of brand (owner portal). */ tone?: 'brand' | 'portal' };

const LEGEND = ['available', 'selected', 'pending', 'booked', 'blocked'] as const;

function Cell({ slot, currency, selected, portal, onToggle }: { slot: SlotJson; currency: string; selected: boolean; portal: boolean; onToggle(): void }) {
  const { t, i18n } = useTranslation();
  const priced = slot.price !== null;
  const clickable = slot.status === 'available' && priced;
  // Why the cell is not clickable, as text (never colour alone).
  const stateKey = slot.status === 'available' ? (priced ? null : 'unavailable') : slot.status;
  const stateLabel = stateKey ? t(`slots.${stateKey}`) : null;
  const cls = [styles.cell, selected ? (portal ? styles.selectedPortal : styles.selected) : styles[stateKey ?? 'available']].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={cls}
      disabled={!clickable}
      aria-pressed={clickable ? selected : undefined}
      aria-label={stateLabel ? `${slot.localStart}, ${stateLabel}` : undefined}
      onClick={onToggle}
    >
      <span className={styles.time}>{slot.localStart}</span>
      <span className={styles.price}>{stateLabel ?? money(slot.price ?? 0, currency, i18n.language)}</span>
    </button>
  );
}

export function SlotGrid({ day, selected, onToggle, tone = 'brand' }: Props) {
  const { t } = useTranslation();
  if (day.status === 'closed') return <p className={styles.message}>{t('slots.closed')}</p>;
  if (day.status === 'outside_window') return <p className={styles.message}>{t('slots.outsideWindow')}</p>;
  if (day.slots.length === 0) return <p className={styles.message}>{t('slots.none')}</p>;

  return (
    <div className={styles.wrap}>
      <ul className={styles.grid} aria-label={t('slots.grid')}>
        {day.slots.map((s) => (
          <li key={s.startAt} className={styles.item}>
            <Cell slot={s} currency={day.currency} selected={selected.includes(s.startAt)} portal={tone === 'portal'} onToggle={() => onToggle(s.startAt)} />
          </li>
        ))}
      </ul>
      <ul className={styles.legend} aria-label={t('slots.legend')}>
        {LEGEND.map((k) => (
          <li key={k} className={styles.legendItem}>
            <span className={[styles.swatch, styles[k === 'selected' && tone === 'portal' ? 'swatch_selectedPortal' : `swatch_${k}`]].join(' ')} aria-hidden="true" />
            {t(`slots.${k}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
