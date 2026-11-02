import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Select } from '../components/ui/Select';
import { Skeleton } from '../components/ui/Skeleton';
import { ApiError } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { formatDate, money } from '../lib/format';
import type { SlotDay, SlotJson } from '../lib/types';
import { DateStrip } from '../venue/DateStrip';
import { SlotGrid } from '../venue/SlotGrid';
import { isSelectable, runOfLength } from '../venue/slotSelection';
import styles from './RescheduleDialog.module.css';

/** Refusals that no other pick can fix: the confirm button goes. */
const FINAL_ERRORS = new Set(['reschedule_not_allowed', 'reschedule_too_late', 'reschedule_limit', 'turf_change_not_allowed', 'invalid_transition', 'too_late']);
/** Errors that mean the grid on screen is stale: it reloads and the pick is cleared. */
const STALE_ERRORS = new Set(['slot_taken', 'slot_unavailable', 'outside_window']);

/** Where a booking is, or is moved to. */
export type MoveTarget = { turfId: string; date: string; startAts: string[] };

export type RescheduleDialogProps<B> = {
  open: boolean;
  onClose: () => void;
  /** The booking's court, venue-local date and slot starts now. */
  current: MoveTarget;
  /** Courts it may move to; the court select shows when there is more than one (staff). */
  turfs?: { id: string; name: string }[];
  /** Venue-local today, the first chip of the date strip. */
  today: string;
  timeZone: string;
  currency: string;
  /** The most the new slots may add up to on the grid (players); no limit when absent. */
  maxPrice?: number;
  /** Whose copy the price note uses: the owner portal passes 'staff' (default 'player'). */
  audience?: 'player' | 'staff';
  loadDay(turfId: string, date: string): Promise<SlotDay>;
  move(target: MoveTarget): Promise<B>;
  onMoved(b: B): void;
  /** `booking_changed`: the page reloads the booking. */
  onConflict?(): void;
};

type Load = { status: 'loading' } | { status: 'ready'; day: SlotDay } | { status: 'error'; error: unknown };

const codeOf = (e: unknown) => (e instanceof ApiError ? e.code : '');

/**
 * "Change time" / "Move booking": a court (staff), a date strip and the slot grid. A tap picks a run as long as the
 * booking, starting at the tapped slot when it fits. The booking's own slots count as free. The price stays.
 */
export function RescheduleDialog<B>({
  open,
  onClose,
  current,
  turfs = [],
  today,
  timeZone,
  currency,
  maxPrice,
  audience = 'player',
  loadDay,
  move,
  onMoved,
  onConflict,
}: RescheduleDialogProps<B>) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const count = current.startAts.length;
  const [turfId, setTurfId] = useState(current.turfId);
  const [date, setDate] = useState(current.date);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [noRun, setNoRun] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const busy = useRef(false);
  const loader = useRef(loadDay);
  loader.current = loadDay;

  // Every opening starts from where the booking is now.
  useEffect(() => {
    if (!open) return;
    setTurfId(current.turfId);
    setDate(current.date);
    setSelected([]);
    setNoRun(false);
    setSubmitError(null);
  }, [open, current.turfId, current.date]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoad({ status: 'loading' });
    loader.current(turfId, date).then(
      (day) => live && setLoad({ status: 'ready', day }),
      (error: unknown) => live && setLoad({ status: 'error', error }),
    );
    return () => {
      live = false;
    };
  }, [open, turfId, date, attempt]);

  const own = new Set(turfId === current.turfId && date === current.date ? current.startAts : []);
  // The booking's own slots show as booked on the grid, but it may move onto them (shift by one slot).
  const day: SlotDay | null =
    load.status === 'ready'
      ? { ...load.day, slots: load.day.slots.map((s) => (own.has(s.startAt) && s.price !== null ? { ...s, status: 'available' as const } : s)) }
      : null;
  const picked: SlotJson[] = day ? day.slots.filter((s) => selected.includes(s.startAt)) : [];
  const ready = picked.length === count;
  const sameAsNow = ready && turfId === current.turfId && date === current.date && picked.every((s) => own.has(s.startAt));
  const price = picked.reduce((n, s) => n + (s.price ?? 0), 0);
  const tooDear = ready && maxPrice !== undefined && price > maxPrice;
  const final = FINAL_ERRORS.has(codeOf(submitError));

  const choose = (next: { turfId?: string; date?: string }) => {
    if (next.turfId !== undefined) setTurfId(next.turfId);
    if (next.date !== undefined) setDate(next.date);
    setSelected([]);
    setNoRun(false);
    if (!final) setSubmitError(null);
  };

  const onToggle = (startAt: string) => {
    if (!day) return;
    if (selected.includes(startAt)) {
      setSelected([]);
      return;
    }
    const run = runOfLength(day.slots, startAt, count, isSelectable);
    setNoRun(run === null);
    setSelected(run ? run.map((s) => s.startAt) : []);
    if (!final) setSubmitError(null);
  };

  const confirm = async () => {
    if (busy.current || !ready) return;
    busy.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const b = await move({ turfId, date, startAts: picked.map((s) => s.startAt) });
      onMoved(b);
    } catch (error) {
      setSubmitError(error);
      const code = codeOf(error);
      if (STALE_ERRORS.has(code)) {
        setSelected([]);
        setAttempt((n) => n + 1);
      }
      if (code === 'booking_changed') onConflict?.();
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  let grid;
  if (load.status === 'error') {
    grid = (
      <Alert tone="danger" className={styles.alert}>
        <span>{errorMessage(load.error, t)}</span>
        <Button size="sm" variant="secondary" icon="refresh" onClick={() => setAttempt((n) => n + 1)}>
          {t('auth.retry')}
        </Button>
      </Alert>
    );
  } else if (!day) {
    grid = <Skeleton kind="list" label={t('common.loading')} />;
  } else {
    grid = <SlotGrid day={day} selected={selected} onToggle={onToggle} tone={audience === 'staff' ? 'portal' : 'brand'} />;
  }

  const turfName = turfs.find((x) => x.id === turfId)?.name;
  const range = ready ? `${picked[0]!.localStart}–${picked[picked.length - 1]!.localEnd}` : '';

  return (
    <Dialog open={open} onClose={() => !busy.current && onClose()} title={t(audience === 'staff' ? 'reschedule.staffTitle' : 'reschedule.title')} wide>
      {open && (
        <div className={styles.body}>
          <p className={styles.note}>{t('reschedule.pickHint', { count })}</p>
          {turfs.length > 1 && (
            <Select
              icon="court"
              layout="stacked"
              label={t('reschedule.court')}
              value={turfId}
              disabled={submitting}
              options={turfs.map((x) => ({ value: x.id, label: x.name }))}
              onChange={(e) => choose({ turfId: e.target.value })}
            />
          )}
          <DateStrip today={today} value={date} onChange={(d) => choose({ date: d })} timeZone={timeZone} />
          <div aria-busy={load.status === 'loading'}>{grid}</div>
          {noRun && (
            <p className={styles.warning} role="status">
              {t('reschedule.noRun', { count })}
            </p>
          )}
          {ready && (
            <dl className={styles.summary}>
              <div className={styles.row}>
                <dt>{t('reschedule.newTime')}</dt>
                <dd>
                  {[turfs.length > 1 ? turfName : null, formatDate(date, 'UTC', lang), range].filter(Boolean).join(' · ')}
                </dd>
              </div>
            </dl>
          )}
          {sameAsNow && <p className={styles.warning}>{t('reschedule.sameTime')}</p>}
          {tooDear && (
            <p className={styles.warning} role="alert">
              {t('reschedule.tooDear', { amount: money(price, currency, lang) })}
            </p>
          )}
          <p className={[styles.note, styles.muted].join(' ')}>{t(audience === 'staff' ? 'reschedule.priceKeptStaff' : 'reschedule.priceKept')}</p>
          {submitError !== null && <Alert tone="danger">{errorMessage(submitError, t)}</Alert>}
          <div className={styles.actions}>
            <Button variant="secondary" disabled={submitting} onClick={onClose}>
              {t('reschedule.back')}
            </Button>
            {!final && (
              <Button icon="calendarCheck" loading={submitting} disabled={submitting || !ready || sameAsNow || tooDear} onClick={() => void confirm()}>
                {t('reschedule.confirm')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
