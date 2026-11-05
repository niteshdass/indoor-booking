import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useTranslation } from 'react-i18next';
import { ApiError, apiGet } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useResource, type ResourceState } from '../lib/useResource';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Loading, Text } from '../ui';
import { ownerPath } from './labels';
import type { Membership, OwnerInfo, OwnerMembership, OwnerVenue, Permission } from './types';

/** SecureStore key of the team opened last, so the owner entry goes straight back to it. */
export const LAST_OWNER_KEY = 'owner.last';

export function getLastOwner(): Promise<string | null> {
  return SecureStore.getItemAsync(LAST_OWNER_KEY).catch(() => null);
}

export type OwnerContextValue = {
  ownerId: string;
  owner: OwnerInfo;
  /** The signed-in user's membership of this owner. */
  membership: Membership;
  /** Every owner the user belongs to, for the team switcher. */
  memberships: OwnerMembership[];
  venues: OwnerVenue[];
  can(p: Permission): boolean;
  /** Refetches the venue list; resolves once the new list is in context (or the old one stays, if the fetch fails). */
  reloadVenues(): Promise<void>;
};

/** Exported so tests can mount owner screens without loading the whole provider. */
export const OwnerContext = createContext<OwnerContextValue | null>(null);

export function useOwner(): OwnerContextValue {
  const ctx = useContext(OwnerContext);
  if (!ctx) throw new Error('useOwner must be used inside OwnerProvider');
  return ctx;
}

function firstError(...states: ResourceState<unknown>[]): unknown {
  for (const s of states) if (s.status === 'error') return s.error;
  return undefined;
}

/** Loads the owner, the user's memberships and the venues in parallel and exposes them to the owner screens. */
export function OwnerProvider({ ownerId, children }: { ownerId: string; children: ReactNode }) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const info = useResource<{ owner: OwnerInfo; membership: Membership }>(ownerPath(ownerId));
  const mine = useResource<{ memberships: OwnerMembership[] }>('/me/memberships');
  const venuesPath = ownerPath(ownerId, '/venues');
  const venues = useResource<{ venues: OwnerVenue[] }>(venuesPath);
  const { set: setVenues } = venues;
  const reloadVenues = useCallback(
    () =>
      apiGet<{ venues: OwnerVenue[] }>(venuesPath).then(setVenues, () => {
        // The current list stays; the next open fetches it again.
      }),
    [venuesPath, setVenues],
  );

  const ready = info.state.status === 'ready' && mine.state.status === 'ready' && venues.state.status === 'ready';
  useEffect(() => {
    if (ready) SecureStore.setItemAsync(LAST_OWNER_KEY, ownerId).catch(() => undefined);
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
      <View style={{ flex: 1, backgroundColor: t.bgPage, padding: t.space5, paddingTop: t.space16, gap: t.space4 }}>
        <Text tone={inactive || missing ? 'warning' : 'danger'} accessibilityRole="alert">
          {inactive ? tr('owner.inactive') : missing ? tr('owner.notFound') : errorMessage(error, tr)}
        </Text>
        <Button label={tr('owner.pickTeam')} variant="secondary" onPress={() => router.replace('/owner?pick=1')} />
      </View>
    );
  }
  if (!value) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bgPage, justifyContent: 'center' }}>
        <Loading />
      </View>
    );
  }
  return <OwnerContext.Provider value={value}>{children}</OwnerContext.Provider>;
}
