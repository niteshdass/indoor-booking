import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { apiGet } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { formatDate, money } from '../lib/format';
import type { SlotDay } from '../lib/types';
import { SlotGrid } from './SlotGrid';
import { keepSelectable, toggleSlot } from './slotSelection';
import styles from './SlotsPanel.module.css';

type State = { status: 'loading' } | { status: 'ready'; day: SlotDay } | { status: 'error'; error: unknown };

type Props = { slug: string; turfId: string; turfName: string; date: string; tabId: string };

/** Slots of one turf and date plus the selection. Mount it with a key of turf and date so the selection resets. */
export function SlotsPanel({ slug, turfId, turfName, date, tabId }: Props) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    apiGet<{ day: SlotDay }>(`/venues/${encodeURIComponent(slug)}/turfs/${encodeURIComponent(turfId)}/slots?date=${date}`).then(
      (r) => {
        if (!live) return;
        setSelected((prev) => keepSelectable(r.day.slots, prev));
        setState({ status: 'ready', day: r.day });
      },
      (error: unknown) => live && setState({ status: 'error', error }),
    );
    return () => {
      live = false;
    };
  }, [slug, turfId, date, attempt]);

  const day = state.status === 'ready' ? state.day : null;
  const onToggle = useCallback(
    (startAt: string) => day && setSelected((prev) => toggleSlot(day.slots, prev, startAt)),
    [day],
  );

  const chosen = day ? selected.map((s) => day.slots.find((x) => x.startAt === s)).filter((s) => s !== undefined) : [];
  const total = chosen.reduce((sum, s) => sum + (s.price ?? 0), 0);
  const first = chosen[0];
  const last = chosen[chosen.length - 1];

  const messageOnly =
    state.status === 'loading' || (day !== null && (day.status !== 'open' || day.slots.length === 0));

  let href = '';
  if (day && first) {
    const q = new URLSearchParams({ turf: turfId, date, slots: chosen.map((s) => s.startAt).join(',') });
    href = `/venues/${encodeURIComponent(slug)}/checkout?${q.toString()}`;
  }

  return (
    <section
      id="turf-panel"
      role="tabpanel"
      aria-labelledby={tabId}
      tabIndex={messageOnly ? 0 : undefined}
      className={styles.panel}
    >
      <div className={styles.main}>
        <h2 className={styles.title}>{t('venue.slotsRegion')}</h2>
        <p className={styles.caption}>{t('venue.selected', { turf: turfName, date: formatDate(date, 'UTC', i18n.language) })}</p>
        {state.status === 'loading' && (
          <div className={styles.loading}>
            <Spinner label={t('common.loading')} />
          </div>
        )}
        {state.status === 'error' && (
          <Alert tone="danger" className={styles.alert}>
            <span>{errorMessage(state.error, t)}</span>
            <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              {t('search.retry')}
            </Button>
          </Alert>
        )}
        {day && <SlotGrid day={day} selected={selected} onToggle={onToggle} />}
      </div>

      <p className={styles.live} aria-live="polite">
        {first ? t('slots.selectedCount', { count: chosen.length }) : ''}
      </p>
      {day && (
        <aside className={[styles.bar, first ? '' : styles.barEmpty].filter(Boolean).join(' ')} aria-label={t('slots.summary')}>
          {first && last ? (
            <>
              <div className={styles.info}>
                <span className={styles.count}>{t('slots.selectedCount', { count: chosen.length })}</span>
                <span className={styles.range}>
                  {first.localStart}–{last.localEnd}
                </span>
                <span className={styles.total}>{money(total, day.currency, i18n.language)}</span>
              </div>
              <Button to={href} variant="brand" size="lg">
                {t('slots.continue')}
              </Button>
            </>
          ) : (
            <p className={styles.hint}>{t('slots.pickHint')}</p>
          )}
        </aside>
      )}
    </section>
  );
}
