import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { WEEKDAYS, isIsoDate } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Dialog } from '../../components/ui/Dialog';
import { Select } from '../../components/ui/Select';
import { Spinner } from '../../components/ui/Spinner';
import { TextField } from '../../components/ui/TextField';
import { apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { weekdayNames } from '../settings/HoursEditor';
import type { OwnerSlotDay, OwnerTurf } from '../types';
import { useResource } from '../useResource';
import { overrideBody, REASON_MAX, type OverrideDraft, type OverrideType } from './overrideBody';
import styles from './overrides.module.css';

const TYPES: readonly OverrideType[] = ['block', 'modify', 'add', 'close'];

const EMPTY: OverrideDraft = {
  type: 'block',
  when: 'date',
  date: '',
  weekdays: [],
  from: '',
  until: '',
  start: '',
  end: '',
  slotStart: '',
  price: '',
  reason: '',
};

type Props = { open: boolean; onClose(): void; turf: OwnerTurf; currency: string; onCreated(): void };

/** Add-override dialog. The body is mounted only while open so every opening starts from a blank draft. */
export function OverrideForm({ open, onClose, turf, currency, onCreated }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} title={t('owner.override.formTitle')}>
      {open && <OverrideFormBody onClose={onClose} turf={turf} currency={currency} onCreated={onCreated} />}
    </Dialog>
  );
}

function OverrideFormBody({ onClose, turf, currency, onCreated }: Omit<Props, 'open'>) {
  const { t, i18n } = useTranslation();
  const { ownerId } = useOwner();
  const base = ownerPath(ownerId, `/venues/${encodeURIComponent(turf.venueId)}/turfs/${encodeURIComponent(turf.id)}`);
  const names = weekdayNames(i18n.language);
  const [d, setD] = useState<OverrideDraft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (patch: Partial<OverrideDraft>) => setD((prev) => ({ ...prev, ...patch }));

  // A modify of one dated slot picks from the slots generated for that date.
  const pickSlot = d.type === 'modify' && d.when === 'date';
  const slots = useResource<{ day: OwnerSlotDay }>(pickSlot && isIsoDate(d.date) ? `${base}/slots?date=${d.date}` : null);
  const day = slots.state.status === 'ready' ? slots.state.data.day : null;

  const nextDay = d.type !== 'close' && d.start !== '' && d.end !== '' && d.end <= d.start;
  const err = (field: string) => (errors[field] ? t(errors[field]) : undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const res = overrideBody(d, currency);
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await apiPost(`${base}/overrides`, res.body);
      onCreated();
      onClose();
    } catch (e2) {
      setError(e2);
    }
    setBusy(false);
  };

  return (
    <form className={styles.body} onSubmit={submit} noValidate>
      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      <Select
        layout="stacked"
        label={t('owner.override.typeLabel')}
        value={d.type}
        options={TYPES.map((x) => ({ value: x, label: t(`owner.override.type.${x}`) }))}
        onChange={(e) => set({ type: e.target.value as OverrideType, slotStart: '' })}
      />
      <Select
        layout="stacked"
        label={t('owner.override.whenLabel')}
        value={d.when}
        options={[
          { value: 'date', label: t('owner.override.whenDate') },
          { value: 'recurring', label: t('owner.override.whenRecurring') },
        ]}
        onChange={(e) => set({ when: e.target.value as OverrideDraft['when'], slotStart: '' })}
      />
      {d.when === 'date' ? (
        <TextField label={t('owner.override.date')} type="date" value={d.date} error={err('date')} onChange={(e) => set({ date: e.target.value, slotStart: '' })} />
      ) : (
        <>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>{t('owner.override.weekdays')}</legend>
            <div className={styles.checks}>
              {WEEKDAYS.map((w) => (
                <Checkbox
                  key={w}
                  label={names[w]}
                  checked={d.weekdays.includes(w)}
                  onChange={(on) => set({ weekdays: on ? [...d.weekdays, w] : d.weekdays.filter((x) => x !== w) })}
                />
              ))}
            </div>
            {errors.weekdays && <p className={styles.error}>{t(errors.weekdays)}</p>}
          </fieldset>
          <div className={styles.pair}>
            <TextField label={t('owner.override.from')} type="date" value={d.from} error={err('from')} onChange={(e) => set({ from: e.target.value })} />
            <TextField label={t('owner.override.until')} type="date" value={d.until} error={err('until')} onChange={(e) => set({ until: e.target.value })} />
          </div>
        </>
      )}
      {d.type === 'modify' &&
        (pickSlot ? (
          <>
            <Select
              layout="stacked"
              label={t('owner.override.slotStart')}
              value={d.slotStart}
              disabled={!day}
              options={[
                { value: '', label: slots.state.status === 'loading' ? t('owner.override.slotsLoading') : t('owner.override.slotPick') },
                ...(day?.slots ?? []).map((s) => ({ value: s.localStart, label: `${s.localStart} – ${s.localEnd}` })),
              ]}
              onChange={(e) => {
                const slot = day?.slots.find((s) => s.localStart === e.target.value);
                set(slot ? { slotStart: slot.localStart, start: slot.localStart, end: slot.localEnd } : { slotStart: '' });
              }}
            />
            {slots.state.status === 'loading' && <Spinner label={t('common.loading')} />}
            {slots.state.status === 'error' && <Alert tone="danger">{errorMessage(slots.state.error, t)}</Alert>}
            {day && day.slots.length === 0 && <p className={styles.muted}>{t('owner.override.slotsNone')}</p>}
            {errors.slotStart && <p className={styles.error}>{t(errors.slotStart)}</p>}
          </>
        ) : (
          <TextField label={t('owner.override.slotStart')} type="time" value={d.slotStart} error={err('slotStart')} onChange={(e) => set({ slotStart: e.target.value })} />
        ))}
      {d.type !== 'close' && (
        <div className={styles.pair}>
          <TextField label={t('owner.override.start')} type="time" value={d.start} error={err('start')} onChange={(e) => set({ start: e.target.value })} />
          <TextField
            label={t('owner.override.end')}
            type="time"
            value={d.end}
            error={err('end')}
            hint={nextDay ? t('owner.override.nextDay') : undefined}
            onChange={(e) => set({ end: e.target.value })}
          />
        </div>
      )}
      {(d.type === 'modify' || d.type === 'add') && (
        <TextField label={t('owner.override.price')} inputMode="decimal" value={d.price} error={err('price')} onChange={(e) => set({ price: e.target.value })} />
      )}
      <TextField label={t('owner.override.reason')} maxLength={REASON_MAX} value={d.reason} error={err('reason')} onChange={(e) => set({ reason: e.target.value })} />
      <p className={styles.muted}>{t('owner.override.existingBookings')}</p>
      <div className={styles.actions}>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          {t('owner.venues.cancel')}
        </Button>
        <Button type="submit" loading={busy}>
          {t('owner.override.save')}
        </Button>
      </div>
    </form>
  );
}
