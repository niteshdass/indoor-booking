import type { OwnerPlatformFeeJson } from '@booking/shared';
import type { IconName } from '../../ui';
import type { Permission } from '../types';

export type MenuGroup = 'daily' | 'setup' | 'team';
export type MenuItem = { route: string; key: string; icon: IconName; group: MenuGroup; perms: Permission[]; any?: boolean };

export const MENU_GROUPS: MenuGroup[] = ['daily', 'setup', 'team'];

/**
 * More-tab rows in board order. Permissions match the web sidebar (apps/web/src/owner/shell/nav.ts); the platform fee
 * row additionally needs `platformFeeShown`.
 */
export const MENU: MenuItem[] = [
  { route: '/series', key: 'owner.nav.series', icon: 'repeat', group: 'daily', perms: ['booking.view'] },
  { route: '/reviews', key: 'owner.nav.reviews', icon: 'star', group: 'daily', perms: ['review.manage'] },
  { route: '/venues', key: 'owner.nav.venues', icon: 'venue', group: 'setup', perms: [] },
  { route: '/closures', key: 'owner.nav.closures', icon: 'calendar', group: 'setup', perms: ['slot.override', 'settings.edit'], any: true },
  { route: '/coupons', key: 'owner.nav.coupons', icon: 'tag', group: 'setup', perms: ['coupon.manage'] },
  { route: '/extras', key: 'owner.nav.addons', icon: 'plus', group: 'setup', perms: ['addon.manage'] },
  { route: '/settings', key: 'owner.nav.settings', icon: 'settings', group: 'setup', perms: ['settings.edit'] },
  { route: '/staff', key: 'owner.nav.staff', icon: 'users', group: 'team', perms: ['staff.manage'] },
  { route: '/platform-fee', key: 'owner.nav.platformFee', icon: 'card', group: 'team', perms: ['settings.edit'] },
];

export function visibleMenu(can: (p: Permission) => boolean, feeShown: boolean): MenuItem[] {
  return MENU.filter((m) => (m.any ? m.perms.some(can) : m.perms.every(can)) && (m.route !== '/platform-fee' || feeShown));
}

/** Copied from apps/web/src/owner/platform/feeShown.ts: the fee UI only shows while a fee applies or a balance is left. */
export function platformFeeShown(fee: OwnerPlatformFeeJson): boolean {
  return fee.feeActive || fee.balances.some((b) => b.balance !== 0 || b.pending > 0);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
