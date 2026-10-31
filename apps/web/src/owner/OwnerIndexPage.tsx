import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Spinner } from '../components/ui/Spinner';
import { errorMessage } from '../lib/errors';
import { LAST_OWNER_KEY } from './OwnerProvider';
import { useResource } from './useResource';
import type { OwnerMembership } from './types';
import styles from './owner.module.css';

function lastOwner(): string | null {
  try {
    return localStorage.getItem(LAST_OWNER_KEY);
  } catch {
    return null;
  }
}

/** `/owner`: sends the user to their remembered active team, or the first active one; otherwise says where things stand. */
export function OwnerIndexPage() {
  const { t } = useTranslation();
  const navState = useLocation().state as { applied?: string; ownerId?: string } | null;
  const justApplied = navState?.applied === 'active';
  const { state } = useResource<{ memberships: OwnerMembership[] }>('/me/memberships');
  if (state.status === 'error') {
    return (
      <div className={styles.state}>
        <Alert tone="danger">{errorMessage(state.error, t)}</Alert>
      </div>
    );
  }
  if (state.status !== 'ready') return <Spinner label={t('common.loading')} />;
  const { memberships } = state.data;
  if (memberships.length === 0) {
    return (
      <div className={styles.state}>
        <EmptyState
          title={t('owner.noTeams')}
          description={t('owner.noTeamsHint')}
          action={
            <Button to="/list-your-venue" variant="brand" icon="arrowRight">
              {t('landing.owners.cta')}
            </Button>
          }
        />
      </div>
    );
  }
  const active = memberships.filter((m) => m.ownerStatus === 'active');
  if (active.length === 0) {
    // Only businesses waiting for approval or suspended: one card each, saying which.
    return (
      <div className={styles.state}>
        {memberships.map((m) => (
          <Alert key={m.ownerId} tone={m.ownerStatus === 'suspended' ? 'danger' : 'info'}>
            <span className={styles.teamStatus}>
              <strong>{m.ownerName}</strong>
              <Badge tone={m.ownerStatus === 'suspended' ? 'danger' : 'warning'}>{t(`owner.status.${m.ownerStatus}`)}</Badge>
            </span>
            <p className={styles.teamNote}>
              {m.ownerStatus === 'suspended' ? t('owner.suspendedNote') : t('owner.pendingNote')}
            </p>
          </Alert>
        ))}
      </div>
    );
  }
  const last = lastOwner();
  const target = active.find((m) => m.ownerId === last) ?? active[0]!;
  if (justApplied) {
    const created = active.find((m) => m.ownerId === navState?.ownerId) ?? target;
    // Just approved on the spot: say so before dropping them into the dashboard.
    return (
      <div className={styles.state}>
        <Alert tone="success">{t('apply.live')}</Alert>
        <Button to={`/owner/${created.ownerId}`} variant="brand" icon="arrowRight">
          {t('apply.goToDashboard')}
        </Button>
      </div>
    );
  }
  return <Navigate to={`/owner/${target.ownerId}`} replace />;
}
