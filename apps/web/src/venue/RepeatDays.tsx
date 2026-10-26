import { useTranslation } from 'react-i18next';
import type { SlotDay } from '../lib/types';
import { isSelectable } from './slotSelection';
import styles from './RepeatDays.module.css';

type Props = {
  /** The days on offer, already fetched. */
  days: SlotDay[];
  /** Venue-local start times ('HH:mm') of the pick. */
  localStarts: string[];
  /** Dates that already have these times. */
  value: string[];
  /** No more bookings fit in one checkout; chips that are off are disabled. */
  full: boolean;
  onToggle(date: string): void;
};

const at = (d: string) => new Date(`${d}T00:00:00Z`);

/** What the picked times cost on `day`, or null when any of them is not free there. */
export function priceOn(day: SlotDay, localStarts: string[]): number | null {
  if (day.status !== 'open' || localStarts.length === 0) return null;
  let total = 0;
  for (const time of localStarts) {
    const slot = day.slots.find((s) => s.localStart === time);
    if (!slot || !isSelectable(slot)) return null;
    total += slot.price ?? 0;
  }
  return total;
}

/** Toggle chips that copy this day's times onto the next days, or clear them there. */
export function RepeatDays({ days, localStarts, value, full, onToggle }: Props) {
  const { t, i18n } = useTranslation();
  if (localStarts.length === 0 || days.length === 0) return null;

  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' });
  const dayMonth = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const chosen = new Set(value);

  return (
    <section className={styles.repeat} aria-labelledby="repeat-days-heading">
      <div className={styles.head}>
        <h3 id="repeat-days-heading" className={styles.title}>
          {t('slots.repeat')}
        </h3>
        <p className={styles.hint}>{t('slots.repeatHint')}</p>
      </div>
      <div className={styles.chips} role="group" aria-labelledby="repeat-days-heading">
        {days.map((d) => {
          const free = priceOn(d, localStarts) !== null;
          const on = chosen.has(d.businessDate);
          return (
            <button
              key={d.businessDate}
              type="button"
              className={[styles.chip, on ? styles.on : ''].filter(Boolean).join(' ')}
              aria-pressed={on}
              disabled={!free || (full && !on)}
              onClick={() => onToggle(d.businessDate)}
            >
              {on && (
                <svg className={styles.check} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              )}
              <span className={styles.weekday}>{weekday.format(at(d.businessDate))}</span>
              <span className={styles.date}>{dayMonth.format(at(d.businessDate))}</span>
              {!free && <span className={styles.hidden}>{t('slots.repeatNotFree')}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
