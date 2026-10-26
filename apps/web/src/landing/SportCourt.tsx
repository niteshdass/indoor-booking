import type { Sport } from '@booking/shared';
import styles from './LandingPage.module.css';

export const TILE_SPORTS = ['padel', 'futsal', 'tennis', 'badminton', 'basketball', 'volleyball'] as const satisfies readonly Sport[];

/** Top-down court markings, drawn in court lines (design-system.md "Hard court"). */
const MARKINGS: Record<(typeof TILE_SPORTS)[number], string> = {
  padel: 'M60 2v76M2 22h116M2 58h116M30 22v36M90 22v36',
  futsal: 'M60 2v76M72 40a12 12 0 1 1-24 0 12 12 0 0 1 24 0M2 22h14a18 18 0 0 1 0 36H2M118 22h-14a18 18 0 0 0 0 36h14',
  tennis: 'M2 12h116M2 68h116M60 2v76M32 12v56M88 12v56M32 40h56',
  badminton: 'M2 8h116M2 72h116M60 2v76M44 2v76M76 2v76M8 2v76M112 2v76M8 40h36M76 40h36',
  basketball: 'M60 2v76M70 40a10 10 0 1 1-20 0 10 10 0 0 1 20 0M2 28h22v24H2M118 28H96v24h22M6 10a34 30 0 0 1 0 60M114 10a34 30 0 0 0 0 60',
  volleyball: 'M60 2v76M40 2v76M80 2v76',
};

export function SportCourt({ sport }: { sport: (typeof TILE_SPORTS)[number] }) {
  return (
    <svg className={styles.sportCourt} viewBox="0 0 120 80" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="116" height="76" rx="2" />
      <path d={MARKINGS[sport]} />
    </svg>
  );
}
