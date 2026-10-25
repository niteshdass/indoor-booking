import type { Permission } from '../types';

export type NavItem = { to: string; key: string; perms: Permission[]; any?: boolean };

/** Sidebar items in display order; `to` is relative to `/owner/:ownerId`. `ownerRoutes` guards each page with the same perms. */
export const NAV: NavItem[] = [
  { to: '', key: 'owner.nav.today', perms: ['booking.view'] },
  { to: 'schedule', key: 'owner.nav.schedule', perms: ['booking.view'] },
  { to: 'bookings', key: 'owner.nav.bookings', perms: ['booking.view'] },
  { to: 'walk-in', key: 'owner.nav.walkIn', perms: ['booking.create'] },
  { to: 'venues', key: 'owner.nav.venues', perms: [] },
  { to: 'closures', key: 'owner.nav.closures', perms: ['slot.override', 'settings.edit'], any: true },
  { to: 'addons', key: 'owner.nav.addons', perms: ['addon.manage'] },
  { to: 'settings', key: 'owner.nav.settings', perms: ['settings.edit'] },
  { to: 'staff', key: 'owner.nav.staff', perms: ['staff.manage'] },
  { to: 'activity', key: 'owner.nav.activity', perms: ['reports.view'] },
];
