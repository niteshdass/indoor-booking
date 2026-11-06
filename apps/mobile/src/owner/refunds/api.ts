import type { TFunction } from 'i18next';
import { ownerPath } from '../labels';
import type { RefundJson } from '../types';

/** A refund from GET /owners/:id/refunds: the owner refund JSON plus a short summary of its booking. */
export type RefundToSend = RefundJson & {
  booking: {
    id: string;
    reference: string;
    businessDate: string;
    venueId: string;
    turf: { name: string } | null;
    customer: { name: string; phone: string | null } | null;
  } | null;
};

export type RefundsPage = { refunds: RefundToSend[]; nextBefore: string | null };

/** Pending wallet refunds staff still have to send by hand, 50 a page (the API's defaults). */
export function refundsToSendPath(ownerId: string, opts: { venueId?: string; before?: string } = {}): string {
  const q = new URLSearchParams({ method: 'wallet', status: 'pending' });
  if (opts.venueId) q.set('venueId', opts.venueId);
  if (opts.before) q.set('before', opts.before);
  return ownerPath(ownerId, `/refunds?${q.toString()}`);
}

/** The first page's count, `N+` when more pages follow; null when there is nothing to send. */
export function refundsCount(page: RefundsPage | null): string | null {
  if (!page || page.refunds.length === 0) return null;
  return `${page.refunds.length}${page.nextBefore !== null ? '+' : ''}`;
}

/** "3 waiting to be sent" (or "50+ …"), pluralised on the first page's count. */
export function refundsWaiting(page: RefundsPage, tr: TFunction): string {
  return tr('mobile.owner.refunds.waiting', { count: page.refunds.length, n: refundsCount(page) ?? '0' });
}
