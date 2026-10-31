import type { Permission } from '../types';

export type NavGroup = 'daily' | 'setup' | 'team';
export type NavItem = { to: string; key: string; group: NavGroup; perms: Permission[]; any?: boolean };

export const NAV_GROUPS: NavGroup[] = ['daily', 'setup', 'team'];

/** Sidebar items in display order; `to` is relative to `/owner/:ownerId`. `ownerRoutes` guards each page with the same perms, and `/owner/:ownerId` opens the first one the member may see. */
export const NAV: NavItem[] = [
  { to: 'overview', key: 'owner.nav.overview', group: 'daily', perms: ['reports.view'] },
  { to: 'today', key: 'owner.nav.today', group: 'daily', perms: ['booking.view'] },
  { to: 'schedule', key: 'owner.nav.schedule', group: 'daily', perms: ['booking.view'] },
  { to: 'bookings', key: 'owner.nav.bookings', group: 'daily', perms: ['booking.view'] },
  { to: 'walk-in', key: 'owner.nav.walkIn', group: 'daily', perms: ['booking.create'] },
  { to: 'series', key: 'owner.nav.series', group: 'daily', perms: ['booking.view'] },
  { to: 'venues', key: 'owner.nav.venues', group: 'setup', perms: [] },
  { to: 'closures', key: 'owner.nav.closures', group: 'setup', perms: ['slot.override', 'settings.edit'], any: true },
  { to: 'addons', key: 'owner.nav.addons', group: 'setup', perms: ['addon.manage'] },
  { to: 'settings', key: 'owner.nav.settings', group: 'setup', perms: ['settings.edit'] },
  { to: 'staff', key: 'owner.nav.staff', group: 'team', perms: ['staff.manage'] },
  { to: 'reviews', key: 'owner.nav.reviews', group: 'team', perms: ['review.manage'] },
  { to: 'activity', key: 'owner.nav.activity', group: 'team', perms: ['reports.view'] },
];
