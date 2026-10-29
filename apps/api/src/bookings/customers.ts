import { User } from '../auth/user.model';
import type { TenantContext } from '../tenancy/context';
import { tenantRepo } from '../tenancy/repo';
import { Booking } from './booking.model';

/** Most suggestions one search returns. */
export const CUSTOMER_LIMIT = 8;
/** Guest bookings scanned per search, newest first. */
const SCAN_LIMIT = 200;
/** Digits needed before a search also matches phone numbers. */
const PHONE_MIN_DIGITS = 3;

export type CustomerJson = { name: string; phone: string; playerId: string | null };

export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * People who have booked with this owner (within the member's venues) whose name or phone matches
 * `q`: walk-in and guest bookings by their recorded name and phone, registered players by their
 * account. One entry per player, or per phone for guests; most recent guest bookings first.
 */
export async function searchCustomers(t: TenantContext, q: string): Promise<CustomerJson[]> {
  const name = new RegExp(escapeRegExp(q), 'i');
  const digits = q.replace(/\D/g, '');
  const phone = digits.length >= PHONE_MIN_DIGITS ? new RegExp(digits) : null;
  const repo = tenantRepo(Booking, t, { venueField: 'venueId' });

  const guests = await repo
    .find({ guest: { $ne: null }, $or: [{ 'guest.name': name }, ...(phone ? [{ 'guest.phone': phone }] : [])] }, { guest: 1, playerId: 1 })
    .sort({ startAt: -1 })
    .limit(SCAN_LIMIT);
  const playerIds = await repo.find({ playerId: { $ne: null } }).distinct('playerId');
  const players = playerIds.length
    ? await User.find({ _id: { $in: playerIds }, $or: [{ name }, ...(phone ? [{ phone }] : [])] }, { name: 1, phone: 1 })
        .sort({ name: 1 })
        .limit(CUSTOMER_LIMIT)
    : [];

  const out = new Map<string, CustomerJson>();
  for (const b of guests) {
    const playerId = b.playerId ? String(b.playerId) : null;
    const key = playerId ?? b.guest!.phone;
    if (!out.has(key)) out.set(key, { name: b.guest!.name, phone: b.guest!.phone, playerId });
  }
  for (const u of players) {
    const playerId = String(u._id);
    if (!out.has(playerId)) out.set(playerId, { name: u.name, phone: u.phone ?? '', playerId });
  }
  return [...out.values()].slice(0, CUSTOMER_LIMIT);
}

/** A booking filter matching `q` against the reference, the customer's name or phone, or a registered player's. */
export async function bookingSearchFilter(q: string): Promise<Record<string, unknown>> {
  const text = new RegExp(escapeRegExp(q.trim()), 'i');
  const digits = q.replace(/\D/g, '');
  const phone = digits.length >= PHONE_MIN_DIGITS ? new RegExp(digits) : null;
  const players = await User.find({ $or: [{ name: text }, ...(phone ? [{ phone }] : [])] }, { _id: 1 }).limit(SCAN_LIMIT);
  return {
    $or: [
      { reference: text },
      { 'guest.name': text },
      ...(phone ? [{ 'guest.phone': phone }] : []),
      ...(players.length ? [{ playerId: { $in: players.map((u) => u._id) } }] : []),
    ],
  };
}
