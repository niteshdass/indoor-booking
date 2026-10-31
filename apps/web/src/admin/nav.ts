/**
 * Sidebar items in display order; `to` is relative to `/admin`, `icon` is a NavIcon key. `external` items open in a
 * new tab. `perm` items show only to admins whose role has that permission.
 */
export const ADMIN_NAV = [
  { to: '', key: 'admin.nav.overview', icon: 'owner.nav.overview' },
  { to: 'owners', key: 'admin.nav.owners', icon: 'owner.nav.venues' },
  { to: 'payouts', key: 'admin.nav.payouts', icon: 'owner.nav.settings', perm: 'platform.owners' },
  { to: 'users', key: 'admin.nav.users', icon: 'owner.nav.staff' },
  { to: 'reviews', key: 'admin.nav.reviews', icon: 'owner.nav.reviews' },
  { to: 'activity', key: 'admin.nav.activity', icon: 'owner.nav.activity' },
  { to: 'settings', key: 'admin.nav.settings', icon: 'owner.nav.settings' },
  { to: 'docs', key: 'admin.nav.docs', icon: 'admin.nav.docs', external: true },
] as const;
