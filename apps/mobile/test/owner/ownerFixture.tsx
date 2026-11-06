import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SYSTEM_ROLES } from '@booking/shared';
import { OwnerContext, type OwnerContextValue } from '../../src/owner/OwnerProvider';
import type { OwnerVenue, Permission } from '../../src/owner/types';
import { ThemeProvider } from '../../src/theme/ThemeProvider';

/** Shared fixtures for owner-mode screen tests: one team, one venue, the owner role unless `perms` says otherwise. */
export const venue: OwnerVenue = {
  id: 'v1',
  name: 'Arena One',
  slug: 'arena-one',
  address: 'Road 1',
  city: 'Dhaka',
  country: 'BD',
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
  location: { lat: 23.8, lng: 90.4 },
  photos: [],
  amenities: [],
  published: true,
  settings: {},
  effectiveSettings: {} as OwnerVenue['effectiveSettings'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

export function ownerValue(over: Partial<OwnerContextValue> & { perms?: readonly Permission[] } = {}): OwnerContextValue {
  const { perms = SYSTEM_ROLES.owner, ...rest } = over;
  return {
    ownerId: 'o1',
    owner: { id: 'o1', name: 'Arena Group', country: 'BD', defaultCurrency: 'BDT', defaultLocale: 'en', status: 'active' },
    membership: { id: 'm1', role: { id: 'r1', key: 'owner', name: 'Owner' }, permissions: [...perms], venueIds: 'all' },
    memberships: [
      { ownerId: 'o1', ownerName: 'Arena Group', ownerStatus: 'active', role: { id: 'r1', key: 'owner', name: 'Owner' }, permissions: [...perms], venueIds: 'all' },
    ],
    venues: [venue],
    can: (p) => perms.includes(p),
    reloadVenues: jest.fn(async () => undefined),
    ...rest,
  };
}

/** Safe area + theme + owner context around a screen (Sheet needs the safe area). */
export function OwnerWrap({ value = ownerValue(), children }: { value?: OwnerContextValue; children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <ThemeProvider>
        <OwnerContext.Provider value={value}>{children}</OwnerContext.Provider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
