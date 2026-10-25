import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Spinner } from '../components/ui/Spinner';
import { ApiError } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { ownerPath } from './ownerApi';
import { useResource, type ResourceState } from './useResource';
import type { Membership, OwnerInfo, OwnerMembership, OwnerVenue, Permission } from './types';
import styles from './owner.module.css';

export const LAST_OWNER_KEY = 'owner.last';

export type OwnerContextValue = {
  ownerId: string;
  owner: OwnerInfo;
  /** The signed-in user's membership of this owner. */
  membership: Membership;
  /** Every owner the user belongs to, for the team switcher. */
  memberships: OwnerMembership[];
  venues: OwnerVenue[];
  can(p: Permission): boolean;
  reloadVenues(): void;
};

const OwnerContext = createContext<OwnerContextValue | null>(null);

export function useOwner(): OwnerContextValue {
  const ctx = useContext(OwnerContext);
  if (!ctx) throw new Error('useOwner must be used inside OwnerProvider');
  return ctx;
}

function firstError(...states: ResourceState<unknown>[]): unknown {
  for (const s of states) if (s.status === 'error') return s.error;
  return undefined;
}

/** Loads the owner, the user's memberships and the venues in parallel and exposes them to the portal. */
export function OwnerProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { ownerId = '' } = useParams();
  const info = useResource<{ owner: OwnerInfo; membership: Membership }>(ownerPath(ownerId));
  const mine = useResource<{ memberships: OwnerMembership[] }>('/me/memberships');
  const venues = useResource<{ venues: OwnerVenue[] }>(ownerPath(ownerId, '/venues'));
  const { reload: reloadVenues } = venues;

  const ready = info.state.status === 'ready' && mine.state.status === 'ready' && venues.state.status === 'ready';
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(LAST_OWNER_KEY, ownerId);
    } catch {
      // Remembering the last team is a convenience only.
    }
  }, [ready, ownerId]);

  const value = useMemo<OwnerContextValue | null>(() => {
    if (info.state.status !== 'ready' || mine.state.status !== 'ready' || venues.state.status !== 'ready') return null;
    const { membership, owner } = info.state.data;
    return {
      ownerId,
      owner,
      membership,
      memberships: mine.state.data.memberships,
      venues: venues.state.data.venues,
      can: (p) => membership.permissions.includes(p),
      reloadVenues,
    };
  }, [info.state, mine.state, venues.state, ownerId, reloadVenues]);

  const error = firstError(info.state, mine.state, venues.state);
  if (error !== undefined) {
    const inactive = [info.state, mine.state, venues.state].some(
      (s) => s.status === 'error' && s.error instanceof ApiError && s.error.code === 'owner_inactive',
    );
    const missing = info.state.status === 'error' && info.state.error instanceof ApiError && info.state.error.status === 404;
    return (
      <div className={styles.state}>
        <Alert tone={inactive || missing ? 'warning' : 'danger'}>
          {inactive ? t('owner.inactive') : missing ? t('owner.notFound') : errorMessage(error, t)}
        </Alert>
        <Link to="/owner">{t('owner.pickTeam')}</Link>
      </div>
    );
  }
  if (!value) return <Spinner label={t('common.loading')} />;
  return <OwnerContext.Provider value={value}>{children}</OwnerContext.Provider>;
}
