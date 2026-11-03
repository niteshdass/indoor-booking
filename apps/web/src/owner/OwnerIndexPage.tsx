import { useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { PageLoader } from '../components/ui/PageLoader';
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
  const { state, reload, updatedAt } = useResource<{ memberships: OwnerMembership[] }>('/me/memberships');
  if (state.status === 'error') {
    return (
      <div className={styles.state}>
        <Alert tone="danger">{errorMessage(state.error, t)}</Alert>
      </div>
    );
  }
  if (state.status !== 'ready') return <PageLoader label={t('common.loading')} />;
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
  if (active.length === 0) return <Waiting memberships={memberships} checkedAt={updatedAt} onCheck={reload} />;
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

/**
 * Only businesses waiting for approval or suspended: what is happening in plain words, the three steps from sending
 * the venue to taking bookings, a way to look again and a way home.
 */
function Waiting({ memberships, checkedAt, onCheck }: { memberships: OwnerMembership[]; checkedAt: number | null; onCheck(): void }) {
  const { t } = useTranslation();
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const suspended = memberships.every((m) => m.ownerStatus === 'suspended');
  const steps = [
    { key: 'sent', state: 'done' },
    { key: 'check', state: 'now' },
    { key: 'open', state: 'next' },
  ] as const;

  return (
    <div className={styles.waitPage}>
      <section className={styles.waitCard} aria-labelledby="owner-waiting">
        <span className={`${styles.waitMark} ${suspended ? styles.waitMarkStop : ''}`}>
          <Icon name={suspended ? 'ban' : 'clock'} />
        </span>
        <div className={styles.waitHead}>
          <h1 id="owner-waiting" className={styles.waitTitle}>
            {t(suspended ? 'owner.waiting.suspendedTitle' : 'owner.waiting.title')}
          </h1>
          <p className={styles.waitLead}>{t(suspended ? 'owner.suspendedNote' : 'owner.pendingNote')}</p>
        </div>
        <ul className={styles.waitTeams}>
          {memberships.map((m) => (
            <li key={m.ownerId} className={styles.waitTeam}>
              <span className={styles.waitTeamName}>{m.ownerName}</span>
              <Badge tone={m.ownerStatus === 'suspended' ? 'danger' : 'warning'}>{t(`owner.status.${m.ownerStatus}`)}</Badge>
            </li>
          ))}
        </ul>
        {!suspended && (
          <ol className={styles.waitSteps}>
            {steps.map((s, i) => (
              <li key={s.key} className={`${styles.waitStep} ${styles[`step_${s.state}`] ?? ''}`} aria-current={s.state === 'now' ? 'step' : undefined}>
                <span className={styles.waitDot} aria-hidden="true">
                  {s.state === 'done' ? <Icon name="check" /> : i + 1}
                </span>
                <span className={styles.waitStepText}>
                  <span className={styles.waitStepLabel}>{t(`owner.waiting.${s.key}`)}</span>
                  <span className={styles.waitStepHint}>{t(`owner.waiting.${s.key}Hint`)}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className={styles.waitActions}>
          <Button to="/" variant="brand" size="lg" icon="arrowLeft">
            {t('owner.waiting.home')}
          </Button>
          {!suspended && (
            <Button
              variant="secondary"
              size="lg"
              icon="refresh"
              onClick={() => {
                setAskedAt(Date.now());
                onCheck();
              }}
            >
              {t('owner.waiting.again')}
            </Button>
          )}
        </div>
        {askedAt !== null && checkedAt !== null && checkedAt >= askedAt && (
          <p className={styles.waitChecked} role="status">
            {t('owner.waiting.checked')}
          </p>
        )}
      </section>
    </div>
  );
}
