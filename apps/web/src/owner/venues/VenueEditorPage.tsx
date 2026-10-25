import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Spinner } from '../../components/ui/Spinner';
import { Tabs } from '../../components/ui/Tabs';
import { apiDelete, apiPatch } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import type { OwnerVenue } from '../types';
import { useResource } from '../useResource';
import { TurfList } from './TurfList';
// Not `VenueForm.tsx`: on case-insensitive file systems that name collides with `venueForm.ts`.
import { VenueForm } from './VenueDetailsForm';
import styles from './venues.module.css';

const TABS = ['details', 'turfs', 'settings', 'addons'] as const;
type Tab = (typeof TABS)[number];

/** `venues/new` creates; `venues/:venueId` edits. */
export function VenueEditorPage() {
  const { t } = useTranslation();
  const { venueId } = useParams();
  const { venues } = useOwner();
  const known = venueId === undefined ? undefined : venues.find((v) => v.id === venueId);
  // Right after a create the list may not have reloaded yet, so fall back to fetching the venue itself.
  const { ownerId } = useOwner();
  const fetched = useResource<{ venue: OwnerVenue }>(venueId && !known ? ownerPath(ownerId, `/venues/${encodeURIComponent(venueId)}`) : null);
  const venue = known ?? (fetched.state.status === 'ready' ? fetched.state.data.venue : undefined);
  useOwnerTitle(venue?.name ?? t('owner.venues.new'));

  if (venueId === undefined) return <NewVenue />;
  if (!venue) {
    if (fetched.state.status === 'error') return <Alert tone="warning">{t('owner.venues.notFound')}</Alert>;
    return <Spinner label={t('common.loading')} />;
  }
  return <VenueEditor key={venue.id} venue={venue} />;
}

function NewVenue() {
  const { can, membership } = useOwner();
  const { t } = useTranslation();
  if (!can('venue.manage') || membership.venueIds !== 'all') return <Alert tone="warning">{t('owner.noAccess')}</Alert>;
  return <VenueForm venue={null} readOnly={false} />;
}

function VenueEditor({ venue }: { venue: OwnerVenue }) {
  const { t } = useTranslation();
  const { can } = useOwner();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: Tab = TABS.find((x) => x === requested) ?? 'details';
  const setTab = (id: string) =>
    setParams(id === 'details' ? {} : { tab: id }, { replace: true });

  return (
    <div className={styles.page}>
      <Tabs label={venue.name} tabs={TABS.map((id) => ({ id, label: t(`owner.venues.tab.${id}`) }))} value={tab} onChange={setTab} />
      {tab === 'details' && (
        <>
          {can('venue.manage') && <PublishBar venue={venue} />}
          <VenueForm venue={venue} readOnly={!can('venue.manage')} />
        </>
      )}
      {tab === 'turfs' && <TurfList venue={venue} />}
      {/* Task 13 drops the venue settings editor here, Task 16 the add-on assignments. */}
      {tab === 'settings' && <p className={styles.muted}>{t('owner.comingSoon')}</p>}
      {tab === 'addons' && <p className={styles.muted}>{t('owner.comingSoon')}</p>}
    </div>
  );
}

/** Publish/unpublish and delete; both go through the API's guards and show its error. */
function PublishBar({ venue }: { venue: OwnerVenue }) {
  const { t } = useTranslation();
  const { ownerId, reloadVenues } = useOwner();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const path = ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}`);

  const togglePublish = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPatch(path, { published: !venue.published });
      reloadVenues();
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await apiDelete(path);
      reloadVenues();
      navigate(`/owner/${ownerId}/venues`);
    } catch (err) {
      setDeleteError(err);
      setBusy(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.publishRow}>
        <Badge tone={venue.published ? 'success' : 'neutral'}>{t(venue.published ? 'owner.venues.published' : 'owner.venues.draft')}</Badge>
        <Button variant="secondary" loading={busy && !confirming} onClick={togglePublish}>
          {t(venue.published ? 'owner.venues.unpublish' : 'owner.venues.publish')}
        </Button>
        <Button variant="danger" onClick={() => setConfirming(true)}>
          {t('owner.venues.delete')}
        </Button>
      </div>
      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      <Dialog open={confirming} onClose={() => !busy && setConfirming(false)} title={t('owner.venues.deleteTitle', { name: venue.name })}>
        <div className={styles.dialogBody}>
          <p className={styles.muted}>{t('owner.venues.deleteBody')}</p>
          {deleteError !== null && <Alert tone="danger">{errorMessage(deleteError, t)}</Alert>}
          <div className={styles.dialogActions}>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              {t('owner.venues.cancel')}
            </Button>
            <Button variant="danger" loading={busy} onClick={remove}>
              {t('owner.venues.deleteConfirm')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
