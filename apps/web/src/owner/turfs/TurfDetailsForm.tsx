import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SPORTS, type Sport } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Dialog } from '../../components/ui/Dialog';
import { TextField } from '../../components/ui/TextField';
import { ApiError, apiDelete, apiPatch } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { OwnerTurf } from '../types';
import styles from './turfs.module.css';

const NAME_MAX = 60;

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

type Props = { turf: OwnerTurf; onSaved(turf: OwnerTurf): void };

/** Name, sports, indoor and active; the slot length is fixed at creation. Edits need `turf.manage`. */
export function TurfDetailsForm({ turf, onSaved }: Props) {
  const { t } = useTranslation();
  const { ownerId, can } = useOwner();
  const editable = can('turf.manage');
  const path = ownerPath(ownerId, `/venues/${encodeURIComponent(turf.venueId)}/turfs/${encodeURIComponent(turf.id)}`);
  const [name, setName] = useState(turf.name);
  const [sports, setSports] = useState<Sport[]>(turf.sports);
  const [indoor, setIndoor] = useState(turf.indoor);
  const [active, setActive] = useState(turf.active);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const nameError = name.trim().length < 1 || name.trim().length > NAME_MAX ? t('owner.venues.err.turfName') : undefined;
  const sportsError = sports.length === 0 ? t('owner.venues.err.sports') : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    setDone(false);
    if (busy || !editable || nameError || sportsError) return;
    const body: Record<string, unknown> = {};
    if (name.trim() !== turf.name) body.name = name.trim();
    if (!sameSet(sports, turf.sports)) body.sports = sports;
    if (indoor !== turf.indoor) body.indoor = indoor;
    if (active !== turf.active) body.active = active;
    if (Object.keys(body).length === 0) {
      setDone(true);
      return;
    }
    setBusy(true);
    try {
      const res = await apiPatch<{ turf: OwnerTurf }>(path, body);
      onSaved(res.turf);
      setDone(true);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };

  return (
    <div className={styles.stack}>
      <form className={styles.card} onSubmit={submit} noValidate>
        {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
        {done && <Alert tone="success">{t('owner.turf.saved')}</Alert>}
        <TextField
          label={t('owner.turf.name')}
          value={name}
          maxLength={NAME_MAX}
          disabled={!editable}
          error={submitted ? nameError : undefined}
          onChange={(e) => setName(e.target.value)}
        />
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{t('owner.venues.sports')}</legend>
          <div className={styles.checks}>
            {SPORTS.map((s) => (
              <Checkbox
                key={s}
                label={t(`sports.${s}`)}
                checked={sports.includes(s)}
                disabled={!editable}
                onChange={(on) => setSports(on ? [...sports, s] : sports.filter((x) => x !== s))}
              />
            ))}
          </div>
          {submitted && sportsError && <p className={styles.error}>{sportsError}</p>}
        </fieldset>
        <Checkbox label={t('owner.venues.indoorLabel')} checked={indoor} disabled={!editable} onChange={setIndoor} />
        <Checkbox label={t('owner.turf.active')} checked={active} disabled={!editable} onChange={setActive} />
        <TextField
          label={t('owner.venues.slotLength')}
          value={t('owner.venues.minutes', { count: turf.slotLengthMin })}
          hint={t('owner.turf.slotLengthFixed')}
          readOnly
        />
        {editable && (
          <div className={styles.actions}>
            <Button type="submit" loading={busy}>
              {t('owner.turf.save')}
            </Button>
          </div>
        )}
      </form>
      {editable && <DeleteTurf turf={turf} path={path} onDeactivated={onSaved} />}
    </div>
  );
}

/** Delete with confirmation. A turf with bookings can't be deleted, so the dialog then offers to deactivate it. */
function DeleteTurf({ turf, path, onDeactivated }: { turf: OwnerTurf; path: string; onDeactivated(turf: OwnerTurf): void }) {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(path);
      navigate(`/owner/${ownerId}/venues/${encodeURIComponent(turf.venueId)}?tab=turfs`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const deactivate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPatch<{ turf: OwnerTurf }>(path, { active: false });
      onDeactivated(res.turf);
      setOpen(false);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };

  const hasBookings = error instanceof ApiError && error.code === 'turf_has_bookings';

  return (
    <div className={styles.card}>
      <div className={styles.actions}>
        <Button variant="danger" onClick={() => setOpen(true)}>
          {t('owner.turf.delete')}
        </Button>
      </div>
      <Dialog open={open} onClose={close} title={t('owner.turf.deleteTitle', { name: turf.name })}>
        <div className={styles.dialogBody}>
          <p className={styles.muted}>{t('owner.turf.deleteBody')}</p>
          {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
          <div className={styles.dialogActions}>
            <Button variant="secondary" disabled={busy} onClick={close}>
              {t('owner.venues.cancel')}
            </Button>
            {hasBookings && turf.active && (
              <Button variant="secondary" loading={busy} onClick={deactivate}>
                {t('owner.turf.deactivate')}
              </Button>
            )}
            <Button variant="danger" loading={busy} onClick={remove}>
              {t('owner.turf.deleteConfirm')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
