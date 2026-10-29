/** Sidebar items in display order; `to` is relative to `/admin`, `icon` is a NavIcon key. */
export const ADMIN_NAV = [
  { to: '', key: 'admin.nav.overview', icon: 'owner.nav.overview' },
  { to: 'owners', key: 'admin.nav.owners', icon: 'owner.nav.venues' },
  { to: 'users', key: 'admin.nav.users', icon: 'owner.nav.staff' },
  { to: 'reviews', key: 'admin.nav.reviews', icon: 'owner.nav.reviews' },
  { to: 'activity', key: 'admin.nav.activity', icon: 'owner.nav.activity' },
] as const;
