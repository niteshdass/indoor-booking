import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SPORTS, type Sport } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Select } from '../../components/ui/Select';
import { Spinner } from '../../components/ui/Spinner';
import { Table } from '../../components/ui/Table';
import { TextField } from '../../components/ui/TextField';
import { apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { OwnerTurf, OwnerVenue } from '../types';
import { useResource } from '../useResource';
import styles from './venues.module.css';

export const DEFAULT_SLOT_MIN = 60;
const SLOT_OPTIONS = Array.from({ length: (240 - 30) / 15 + 1 }, (_, i) => 30 + i * 15);
const NAME_MAX = 60;

/** The venue's turfs, plus (with `turf.manage`) a form to add one. */
export function TurfList({ venue }: { venue: OwnerVenue }) {
  const { t } = useTranslation();
  const { ownerId, can } = useOwner();
  const base = ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/turfs`);
  const { state, reload } = useResource<{ turfs: OwnerTurf[] }>(base);

  if (state.status === 'error') {
    return (
      <Alert tone="danger">
        <p className={styles.muted}>{errorMessage(state.error, t)}</p>
        <Button variant="secondary" onClick={reload}>
          {t('auth.retry')}
        </Button>
      </Alert>
    );
  }
  if (state.status !== 'ready') return <Spinner label={t('common.loading')} />;
  const turfs = state.data.turfs;

  return (
    <div className={styles.stack}>
      {turfs.length === 0 ? (
        <p className={styles.muted}>{t('owner.venues.noTurfs')}</p>
      ) : (
        <Table caption={t('owner.venues.turfs')}>
          <thead>
            <tr>
              <th>{t('owner.venues.turfName')}</th>
              <th>{t('owner.venues.sports')}</th>
              <th>{t('owner.venues.setting')}</th>
              <th>{t('owner.venues.slotLength')}</th>
              <th>{t('owner.venues.status')}</th>
            </tr>
          </thead>
          <tbody>
            {turfs.map((x) => (
              <tr key={x.id}>
                <td>
                  <Link to={`/owner/${ownerId}/venues/${encodeURIComponent(venue.id)}/turfs/${encodeURIComponent(x.id)}`} className={styles.link}>
                    {x.name}
                  </Link>
                </td>
                <td>{x.sports.map((s) => t(`sports.${s}`)).join(', ')}</td>
                <td>{t(x.indoor ? 'venue.indoor' : 'venue.outdoor')}</td>
                <td>{t('owner.venues.minutes', { count: x.slotLengthMin })}</td>
                <td>
                  <Badge tone={x.active ? 'success' : 'neutral'}>{t(x.active ? 'owner.venues.turfActive' : 'owner.venues.turfInactive')}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {can('turf.manage') && <TurfCreateForm venueId={venue.id} base={base} />}
    </div>
  );
}

function TurfCreateForm({ venueId, base }: { venueId: string; base: string }) {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [sports, setSports] = useState<Sport[]>([]);
  const [indoor, setIndoor] = useState(false);
  const [slotLength, setSlotLength] = useState(String(DEFAULT_SLOT_MIN));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const nameError = name.trim().length < 1 || name.trim().length > NAME_MAX ? t('owner.venues.err.turfName') : undefined;
  const sportsError = sports.length === 0 ? t('owner.venues.err.sports') : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (busy || nameError || sportsError) return;
    setBusy(true);
    try {
      const { turf } = await apiPost<{ turf: OwnerTurf }>(base, {
        name: name.trim(),
        sports,
        indoor,
        slotLengthMin: Number(slotLength),
      });
      navigate(`/owner/${ownerId}/venues/${encodeURIComponent(venueId)}/turfs/${encodeURIComponent(turf.id)}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form className={styles.card} onSubmit={submit} noValidate>
      <h2 className={styles.heading}>{t('owner.venues.newTurf')}</h2>
      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      <TextField
        label={t('owner.venues.turfName')}
        value={name}
        maxLength={NAME_MAX}
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
              onChange={(on) => setSports(on ? [...sports, s] : sports.filter((x) => x !== s))}
            />
          ))}
        </div>
        {submitted && sportsError && <p className={styles.error}>{sportsError}</p>}
      </fieldset>
      <Checkbox label={t('owner.venues.indoorLabel')} checked={indoor} onChange={setIndoor} />
      <Select
        layout="stacked"
        label={t('owner.venues.slotLength')}
        value={slotLength}
        onChange={(e) => setSlotLength(e.target.value)}
        options={SLOT_OPTIONS.map((m) => ({ value: String(m), label: t('owner.venues.minutes', { count: m }) }))}
      />
      <div>
        <Button type="submit" loading={busy}>
          {t('owner.venues.createTurf')}
        </Button>
      </div>
    </form>
  );
}
