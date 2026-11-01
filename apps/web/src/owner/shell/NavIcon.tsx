import styles from './OwnerShell.module.css';

/** 24px stroke icons for the sidebar, keyed by the nav item's i18n key, plus a few page icons. */
const PATHS: Record<string, string> = {
  'owner.nav.today': 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  'owner.nav.overview': 'M3 3v18h18M7 16v-4M12 16V8M17 16v-7',
  'owner.nav.schedule': 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 2v4M8 2v4M3 10h18',
  'owner.nav.bookings': 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  'owner.nav.walkIn': 'M12 5v14M5 12h14',
  'owner.nav.series': 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  'owner.nav.venues': 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6',
  'owner.nav.closures': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.9 4.9l14.2 14.2',
  'owner.nav.addons': 'M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z',
  'owner.nav.coupons': 'M3 12.2V4.5A1.5 1.5 0 0 1 4.5 3h7.7l8.5 8.5a1.5 1.5 0 0 1 0 2.1l-7.1 7.1a1.5 1.5 0 0 1-2.1 0L3 12.2zM7.75 9a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5z',
  'owner.nav.settings': 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  'owner.nav.platformFee': 'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM6 12h.01M18 12h.01',
  'owner.nav.staff': 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  'owner.nav.reviews': 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  'owner.nav.activity': 'M22 12h-4l-3 9L9 3l-3 9H2',
  'admin.nav.payouts': 'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM6 12h.01M18 12h.01',
  'admin.nav.docs': 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  playerSite: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
};

export function NavIcon({ navKey }: { navKey: string }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[navKey]} />
    </svg>
  );
}
