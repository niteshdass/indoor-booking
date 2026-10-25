import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
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

/** `/owner`: sends the user to their remembered team, or the first one. */
export function OwnerIndexPage() {
  const { t } = useTranslation();
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
        <Alert tone="info">{t('owner.noTeams')}</Alert>
      </div>
    );
  }
  const last = lastOwner();
  const target = memberships.find((m) => m.ownerId === last) ?? memberships[0]!;
  return <Navigate to={`/owner/${target.ownerId}`} replace />;
}
