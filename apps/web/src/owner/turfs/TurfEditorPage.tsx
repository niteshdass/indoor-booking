import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { Tabs } from '../../components/ui/Tabs';
import { apiPatch } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { HoursEditor } from '../settings/HoursEditor';
import { hoursPatch } from '../settings/settingsPatch';
import { useOwnerTitle } from '../shell/OwnerShell';
import type { OwnerTurf, OwnerVenue, WeeklyHours } from '../types';
import { useResource } from '../useResource';
import { PricingEditor } from './PricingEditor';
import { TurfDetailsForm } from './TurfDetailsForm';
import styles from './turfs.module.css';

const TABS = ['details', 'hours', 'pricing', 'overrides', 'addons'] as const;
type Tab = (typeof TABS)[number];

/** `venues/:venueId/turfs/:turfId`; the tab lives in `?tab=`. */
export function TurfEditorPage() {
  const { t } = useTranslation();
  const { venueId = '', turfId = '' } = useParams();
  const { ownerId, venues } = useOwner();
  const res = useResource<{ turf: OwnerTurf }>(
    ownerPath(ownerId, `/venues/${encodeURIComponent(venueId)}/turfs/${encodeURIComponent(turfId)}`),
  );
  const turf = res.state.status === 'ready' ? res.state.data.turf : undefined;
  useOwnerTitle(turf?.name ?? t('owner.turf.title'));

  if (!turf) {
    if (res.state.status === 'error') return <Alert tone="warning">{t('owner.turf.notFound')}</Alert>;
    return <Spinner label={t('common.loading')} />;
  }
  const venue = venues.find((v) => v.id === venueId);
  return <TurfEditor key={turf.id} turf={turf} venue={venue} onChange={(next) => res.set({ turf: next })} />;
}

function TurfEditor({ turf, venue, onChange }: { turf: OwnerTurf; venue: OwnerVenue | undefined; onChange(turf: OwnerTurf): void }) {
  const { t } = useTranslation();
  const { ownerId, owner } = useOwner();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: Tab = TABS.find((x) => x === requested) ?? 'details';
  const setTab = (id: string) => setParams(id === 'details' ? {} : { tab: id }, { replace: true });

  return (
    <div className={styles.page}>
      <Link to={`/owner/${ownerId}/venues/${encodeURIComponent(turf.venueId)}?tab=turfs`} className={styles.link}>
        {t('owner.turf.back')}
      </Link>
      <Tabs label={turf.name} tabs={TABS.map((id) => ({ id, label: t(`owner.turf.tab.${id}`) }))} value={tab} onChange={setTab} />
      {tab === 'details' && <TurfDetailsForm turf={turf} onSaved={onChange} />}
      {tab === 'hours' && <TurfHours turf={turf} inherited={venue?.effectiveSettings.hours ?? turf.effectiveSettings.hours} onSaved={onChange} />}
      {tab === 'pricing' && (
        <PricingEditor
          turf={turf}
          currency={venue?.currency ?? owner.defaultCurrency}
          onSaved={(pricing) => onChange({ ...turf, pricing })}
        />
      )}
      {/* Task 15 drops the slot overrides here, Task 16 the add-on assignments. */}
      {(tab === 'overrides' || tab === 'addons') && <p className={styles.muted}>{t('owner.comingSoon')}</p>}
    </div>
  );
}

/** Per-turf opening hours; a day left out inherits the venue's. Sent as a per-day diff under `settings.hours`. */
function TurfHours({ turf, inherited, onSaved }: { turf: OwnerTurf; inherited: WeeklyHours; onSaved(turf: OwnerTurf): void }) {
  const { t } = useTranslation();
  const { ownerId, can } = useOwner();
  const editable = can('turf.manage');
  const stored = turf.settings.hours ?? {};
  const [draft, setDraft] = useState<Partial<WeeklyHours>>(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const save = async () => {
    if (busy) return;
    setError(null);
    setDone(false);
    const hours = hoursPatch(stored, draft, true);
    if (!hours) {
      setDone(true);
      return;
    }
    setBusy(true);
    try {
      const res = await apiPatch<{ turf: OwnerTurf }>(
        ownerPath(ownerId, `/venues/${encodeURIComponent(turf.venueId)}/turfs/${encodeURIComponent(turf.id)}`),
        { settings: { hours } },
      );
      onSaved(res.turf);
      setDone(true);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };

  return (
    <div className={styles.card}>
      <h2 className={styles.heading}>{t('owner.turf.hoursTitle')}</h2>
      <p className={styles.muted}>{t('owner.turf.hoursHint')}</p>
      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      {done && <Alert tone="success">{t('owner.turf.hoursSaved')}</Alert>}
      <HoursEditor
        value={draft}
        inherited={inherited}
        onChange={(v) => {
          setDraft(v);
          setDone(false);
        }}
        disabled={!editable}
      />
      {editable && (
        <div className={styles.actions}>
          <Button loading={busy} onClick={save}>
            {t('owner.turf.saveHours')}
          </Button>
        </div>
      )}
    </div>
  );
}
