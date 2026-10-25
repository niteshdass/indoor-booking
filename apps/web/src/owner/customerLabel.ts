import type { TFunction } from 'i18next';
import type { OwnerBooking } from './types';

/** Customer name for owner screens. A null customer is a walk-in without a guest, or an online booking whose player record is gone. */
export function customerLabel(b: Pick<OwnerBooking, 'customer' | 'source'>, t: TFunction): string {
  if (b.customer) return b.customer.name;
  return b.source === 'walkin' ? t('owner.walkInGuest') : t('owner.unknownCustomer');
}
