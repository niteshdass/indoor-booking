export const PERMISSIONS = [
  'venue.manage',
  'turf.manage',
  'pricing.edit',
  'slot.override',
  'booking.view',
  'booking.create',
  'booking.confirm',
  'booking.cancel',
  'booking.checkin',
  'payment.mark_cash',
  'refund.issue',
  'addon.manage',
  'staff.manage',
  'settings.edit',
  'reports.view',
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
