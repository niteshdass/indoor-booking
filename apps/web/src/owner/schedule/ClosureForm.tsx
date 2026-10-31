import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isIsoDate } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Select } from '../../components/ui/Select';
import { TextField } from '../../components/ui/TextField';
import { apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { OwnerTurf } from '../types';
import { REASON_MAX } from './overrideBody';
import styles from './overrides.module.css';

export const MAX_CLOSURE_DAYS = 366;
const DAY_MS = 86_400_000;

type Scope = 'owner' | 'venue' | 'turf';

type Props = { open: boolean; onClose(): void; onCreated(): void; turfsByVenue: Record<string, OwnerTurf[]> };

/** Add-closure dialog. The body is mounted only while open so every opening starts blank. */
export function ClosureForm({ open, onClose, onCreated, turfsByVenue }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} title={t('owner.closures.formTitle')}>
      {open && <ClosureFormBody onClose={onClose} onCreated={onCreated} turfsByVenue={turfsByVenue} />}
    </Dialog>
  );
}

function ClosureFormBody({ onClose, onCreated, turfsByVenue }: Omit<Props, 'open'>) {
  const { t } = useTranslation();
  const { ownerId, venues, membership, can } = useOwner();
  // Owner-wide closures need settings.edit across every venue; venue and turf ones need slot.override.
  const scopes: Scope[] = [
    ...(can('settings.edit') && membership.venueIds === 'all' ? (['owner'] as const) : []),
    ...(can('slot.override') ? (['venue', 'turf'] as const) : []),
  ];
  const [scope, setScope] = useState<Scope>(scopes[0] ?? 'venue');
  const [venueId, setVenueId] = useState(venues[0]?.id ?? '');
  const [turfId, setTurfId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const turfs = turfsByVenue[venueId] ?? [];
  const turf = turfs.find((x) => x.id === turfId) ?? turfs[0];

  const errors: Record<string, string> = {};
  if (scope !== 'owner' && !venues.some((v) => v.id === venueId)) errors.venue = 'owner.closures.err.venue';
  if (scope === 'turf' && !turf) errors.turf = 'owner.closures.err.turf';
  if (!isIsoDate(from)) errors.from = 'owner.closures.err.from';
  if (!isIsoDate(to)) errors.to = 'owner.closures.err.to';
  else if (isIsoDate(from)) {
    if (to < from) errors.to = 'owner.closures.err.order';
    else if ((Date.parse(to) - Date.parse(from)) / DAY_MS + 1 > MAX_CLOSURE_DAYS) errors.to = 'owner.closures.err.long';
  }
  if (reason.trim().length > REASON_MAX) errors.reason = 'owner.closures.err.reason';
  const err = (field: string) => (submitted && errors[field] ? t(errors[field]) : undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (busy || Object.keys(errors).length > 0) return;
    setBusy(true);
    try {
      await apiPost(ownerPath(ownerId, '/closures'), {
        ...(scope === 'owner' ? {} : { venueId }),
        ...(scope === 'turf' && turf ? { turfId: turf.id } : {}),
        from,
        to,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      });
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
        icon="layers"
        layout="stacked"
        label={t('owner.closures.scopeLabel')}
        value={scope}
        options={scopes.map((s) => ({
          value: s,
          label: t(s === 'owner' ? 'owner.closures.ownerWide' : s === 'venue' ? 'owner.closures.scopeVenue' : 'owner.closures.scopeTurf'),
        }))}
        onChange={(e) => setScope(e.target.value as Scope)}
      />
      {scope !== 'owner' && (
        <Select
          icon="venue"
          layout="stacked"
          label={t('owner.closures.venue')}
          value={venueId}
          options={venues.map((v) => ({ value: v.id, label: v.name }))}
          onChange={(e) => {
            setVenueId(e.target.value);
            setTurfId('');
          }}
        />
      )}
      {scope === 'turf' && (
        <>
          <Select
            icon="court"
            layout="stacked"
            label={t('owner.closures.turf')}
            value={turf?.id ?? ''}
            options={turfs.map((x) => ({ value: x.id, label: x.name }))}
            onChange={(e) => setTurfId(e.target.value)}
          />
          {!turf && <p className={styles.muted}>{t('owner.closures.noTurfs')}</p>}
        </>
      )}
      <div className={styles.pair}>
        <TextField label={t('owner.closures.from')} type="date" value={from} error={err('from')} onChange={(e) => setFrom(e.target.value)} />
        <TextField label={t('owner.closures.to')} type="date" value={to} error={err('to')} onChange={(e) => setTo(e.target.value)} />
      </div>
      <TextField icon="note" label={t('owner.closures.reason')} maxLength={REASON_MAX} value={reason} error={err('reason')} onChange={(e) => setReason(e.target.value)} />
      <div className={styles.actions}>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          {t('owner.venues.cancel')}
        </Button>
        <Button icon="check" type="submit" loading={busy}>
          {t('owner.closures.save')}
        </Button>
      </div>
    </form>
  );
}
