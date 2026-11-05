import type { Href } from 'expo-router';
import type { TFunction } from 'i18next';
import type { OwnerBooking, RoleRef } from './types';

/** Path under the owner tenant: `/owners/:ownerId` plus an optional sub-path. */
export function ownerPath(ownerId: string, path = ''): string {
  return `/owners/${ownerId}${path}`;
}

/**
 * App route inside owner mode, e.g. `ownerHref(id, '/booking/abc')` → `/owner/:id/booking/abc`. Typed routes are
 * regenerated only by the dev server, so new owner screens go through this one cast.
 */
export function ownerHref(ownerId: string, path = ''): Href {
  return `/owner/${ownerId}${path}` as Href;
}

/** Display name for a role: system roles are translated, custom roles show the name the owner typed. */
export function roleLabel(role: Pick<RoleRef, 'key' | 'name'>, t: TFunction): string {
  return role.key ? t(`owner.roleName.${role.key}`) : role.name;
}

/** Customer name for owner screens. A null customer is a walk-in without a guest, or an online booking whose player record is gone. */
export function customerLabel(b: Pick<OwnerBooking, 'customer' | 'source'>, t: TFunction): string {
  if (b.customer) return b.customer.name;
  return b.source === 'walkin' ? t('owner.walkInGuest') : t('owner.unknownCustomer');
}
