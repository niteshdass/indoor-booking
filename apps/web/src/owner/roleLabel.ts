import type { TFunction } from 'i18next';
import type { RoleRef } from './types';

/** Display name for a role: system roles are translated, custom roles show the name the owner typed. */
export function roleLabel(role: Pick<RoleRef, 'key' | 'name'>, t: TFunction): string {
  return role.key ? t(`owner.roleName.${role.key}`) : role.name;
}
