import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { moneyShort } from '../lib/format';
import type { SlotDay, SlotJson } from '../lib/types';
import { isSelectable } from './slotSelection';
import styles from './SlotGrid.module.css';

type Props = { day: SlotDay; selected: string[]; onToggle(startAt: string): void; /** `portal` paints the selection with primary instead of brand (owner portal). */ tone?: 'brand' | 'portal' };

const LEGEND = ['available', 'selected', 'pending', 'booked', 'blocked'] as const;

type Period = 'morning' | 'afternoon' | 'evening';

/** Part of the day a slot starts in, from its venue-local "HH:MM". */
function periodOf(localStart: string): Period {
  const h = Number(localStart.slice(0, 2));
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

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
      <span className={styles.price}>{stateLabel ?? moneyShort(slot.price ?? 0, currency, i18n.language)}</span>
    </button>
  );
}

export function SlotGrid({ day, selected, onToggle, tone = 'brand' }: Props) {
  const { t } = useTranslation();
  const id = useId();
  if (day.status === 'closed') return <p className={styles.message}>{t('slots.closed')}</p>;
  if (day.status === 'outside_window') return <p className={styles.message}>{t('slots.outsideWindow')}</p>;
  if (day.slots.length === 0) return <p className={styles.message}>{t('slots.none')}</p>;

  const groups = new Map<Period, SlotJson[]>();
  for (const s of day.slots) {
    const p = periodOf(s.localStart);
    groups.set(p, [...(groups.get(p) ?? []), s]);
  }

  return (
    <div className={styles.wrap}>
      {[...groups].map(([period, slots]) => {
        const free = slots.filter(isSelectable).length;
        return (
          <div key={period} className={styles.group}>
            <div className={styles.groupHead}>
              <h3 id={`${id}-${period}`} className={styles.groupTitle}>
                {t(`slots.${period}`)}
              </h3>
              <span className={styles.groupFree}>{free > 0 ? t('slots.freeCount', { count: free }) : t('slots.noneFree')}</span>
            </div>
            <ul className={styles.grid} aria-labelledby={`${id}-${period}`}>
              {slots.map((s) => (
                <li key={s.startAt} className={styles.item}>
                  <Cell slot={s} currency={day.currency} selected={selected.includes(s.startAt)} portal={tone === 'portal'} onToggle={() => onToggle(s.startAt)} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
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
