export const PERMISSIONS = [
  'venue.manage',
  'turf.manage',
  'pricing.edit',
  'slot.override',
  'booking.view',
  'booking.create',
  'booking.confirm',
  'booking.cancel',
  'booking.reschedule',
  'booking.checkin',
  'payment.mark_cash',
  'payment.verify',
  'refund.issue',
  'addon.manage',
  'coupon.manage',
  'staff.manage',
  'settings.edit',
  'reports.view',
  'review.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MANAGER_EXCLUDED: readonly Permission[] = ['settings.edit', 'staff.manage', 'venue.manage'];

export const SYSTEM_ROLES: Record<'owner' | 'manager' | 'staff', readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => !MANAGER_EXCLUDED.includes(p)),
  staff: ['booking.view', 'booking.create', 'booking.checkin', 'payment.mark_cash'],
};

export type SystemRoleKey = keyof typeof SYSTEM_ROLES;

export const SYSTEM_ROLE_NAMES: Record<SystemRoleKey, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
};

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/** Platform (Super Admin) permissions; never part of an owner role. */
export const PLATFORM_PERMISSIONS = ['platform.view', 'platform.owners', 'platform.users', 'platform.reviews', 'platform.settings'] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export const PLATFORM_ROLES: Record<'super_admin', readonly PlatformPermission[]> = {
  super_admin: PLATFORM_PERMISSIONS,
};

export type PlatformRoleKey = keyof typeof PLATFORM_ROLES;

export const PLATFORM_ROLE_NAMES: Record<PlatformRoleKey, string> = {
  super_admin: 'Super admin',
};

const PLATFORM_PERMISSION_SET: ReadonlySet<string> = new Set(PLATFORM_PERMISSIONS);

export function isPlatformPermission(value: string): value is PlatformPermission {
  return PLATFORM_PERMISSION_SET.has(value);
}
