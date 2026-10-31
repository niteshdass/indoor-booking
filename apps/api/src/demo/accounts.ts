import type { DemoRole } from '@booking/shared';

/** Every seeded account signs in with this password (see scripts/seed.ts). */
export const SEED_PASSWORD = 'password123';
export const SEED_EMAIL_DOMAIN = 'seed.local';

/** The seeded account behind each demo sign-in button. */
export const DEMO_ACCOUNTS: Record<DemoRole, string> = {
  admin: `admin@${SEED_EMAIL_DOMAIN}`,
  owner: `owner@${SEED_EMAIL_DOMAIN}`,
  staff: `staff.owner@${SEED_EMAIL_DOMAIN}`,
  player: `player1@${SEED_EMAIL_DOMAIN}`,
};
