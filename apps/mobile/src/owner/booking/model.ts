import { currencyExponent, localParts, MOVABLE } from '@booking/shared';
import type { OwnerBooking, Permission } from '../types';

/** Port of apps/web/src/owner/bookings/availableActions.ts. */
export type Action = 'verify' | 'confirm' | 'reject' | 'move' | 'cancel' | 'checkIn' | 'noShow' | 'markCash' | 'paymentLink';

type Can = (p: Permission) => boolean;

/** Statuses where staff may still record cash: going ahead, played, or a no-show who paid at the desk. */
const CASH_STATUSES: ReadonlyArray<OwnerBooking['status']> = ['pending', 'confirmed', 'completed', 'no_show'];
const CANCELLABLE: ReadonlyArray<OwnerBooking['status']> = ['pending', 'awaiting_payment', 'confirmed'];

export const startOf = (b: Pick<OwnerBooking, 'slots'>) => Math.min(...b.slots.map((s) => Date.parse(s.startAt)));
export const endOf = (b: Pick<OwnerBooking, 'slots'>) => Math.max(...b.slots.map((s) => Date.parse(s.endAt)));
const ended = (b: OwnerBooking, now: number) => b.slots.length > 0 && endOf(b) <= now;

/** A wallet payment the player sent that staff have not checked yet. */
export const awaitsVerification = (b: Pick<OwnerBooking, 'manualPayment'>): boolean => b.manualPayment?.status === 'pending';

/** What this member can do with the booking right now, in the web order. */
export function availableActions(b: OwnerBooking, can: Can, now: number = Date.now()): Action[] {
  const out: Action[] = [];
  const toVerify = awaitsVerification(b);
  if (toVerify && can('payment.verify')) out.push('verify');
  if (b.status === 'pending' && !toVerify && can('booking.confirm')) out.push('confirm', 'reject');
  if (MOVABLE.includes(b.status) && !ended(b, now) && can('booking.reschedule')) out.push('move');
  if (CANCELLABLE.includes(b.status) && can('booking.cancel')) out.push('cancel');
  if (b.status === 'confirmed' && can('booking.checkin')) out.push('checkIn', 'noShow');
  if (CASH_STATUSES.includes(b.status) && b.amountPaid < b.total && !toVerify && can('payment.mark_cash')) out.push('markCash');
  if (b.status === 'awaiting_payment' && b.source === 'walkin' && can('booking.create')) out.push('paymentLink');
  return out;
}

/** A confirmed booking starting within this long is due for check-in rather than payment. */
export const SOON_MS = 30 * 60_000;

/** The one action a row leads with, or null when none of this member's actions is the obvious next step (web nextStep). */
export function nextStep(b: OwnerBooking, actions: Action[], now: number = Date.now()): Action | null {
  const has = (a: Action) => actions.includes(a);
  if (has('verify')) return 'verify';
  if (b.status === 'pending') return has('confirm') ? 'confirm' : null;
  if (b.status === 'awaiting_payment') return has('paymentLink') ? 'paymentLink' : null;
  if (b.status !== 'confirmed') return null;
  if (startOf(b) <= now + SOON_MS && has('checkIn')) return 'checkIn';
  return has('markCash') ? 'markCash' : null;
}

export const DANGER: ReadonlySet<Action> = new Set(['reject', 'cancel', 'noShow']);
export const PRIMARY: ReadonlySet<Action> = new Set(['verify', 'confirm', 'checkIn']);

/** Minor units as an editable amount, e.g. 150000 BDT → "1500.00" (web lib/format forInput). */
export function forInput(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
}

/** "14:30" on the venue clock. */
export const hm = (iso: string, tz: string) => localParts(new Date(iso), tz).hm;

/** "14:30–16:00" for the booking's whole run. */
export function timeRange(b: Pick<OwnerBooking, 'slots'>, tz: string): string {
  if (b.slots.length === 0) return '';
  return `${hm(new Date(startOf(b)).toISOString(), tz)}–${hm(new Date(endOf(b)).toISOString(), tz)}`;
}

/** "Thu, 5 Nov" for a bare business date, "Thu, 5 Nov" in `tz` for an instant (web formatDate). */
export function dayLabel(isoOrDate: string, tz: string, lang: string): string {
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(isoOrDate);
  return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: bare ? 'UTC' : tz }).format(
    new Date(bare ? `${isoOrDate}T00:00:00Z` : isoOrDate),
  );
}

/** "Thu, 5 Nov 21:10" in the venue zone (web formatDateTime). */
export const dateTime = (iso: string, tz: string, lang: string) => `${dayLabel(iso, tz, lang)} ${hm(iso, tz)}`;
