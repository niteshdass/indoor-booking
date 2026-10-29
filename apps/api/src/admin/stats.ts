import mongoose from 'mongoose';
import { ADMIN_PERIOD_DAYS, type AdminOwnerRowJson, type AdminPersonJson, type CurrencyAmount, type OwnerStatus } from '@booking/shared';
import { User } from '../auth/user.model';
import { Booking } from '../bookings/booking.model';
import { PLAYED_STATUSES } from '../reports/overview';
import { Membership } from '../tenancy/membership.model';
import { systemRole } from '../tenancy/role.model';
import { Venue } from '../venues/venue.model';

const DAY_MS = 86_400_000;
/** Bookings that never became real (unpaid holds) are left out of the counts. */
const NEVER_BOOKED = ['awaiting_payment', 'expired'];

export const periodStart = (now: Date, periodsBack = 1) => new Date(now.getTime() - periodsBack * ADMIN_PERIOD_DAYS * DAY_MS);

const oids = (ids: readonly string[]) => ids.map((id) => new mongoose.Types.ObjectId(id));

/** Bookings made in [from, to), all owners or the listed ones, grouped by owner. */
export async function bookingCounts(from: Date, to: Date, ownerIds?: readonly string[]): Promise<Map<string, number>> {
  const match: Record<string, unknown> = { createdAt: { $gte: from, $lt: to }, status: { $nin: NEVER_BOOKED } };
  if (ownerIds) match.ownerId = { $in: oids(ownerIds) };
  const rows = await Booking.aggregate<{ _id: unknown; n: number }>([{ $match: match }, { $group: { _id: '$ownerId', n: { $sum: 1 } } }]).option({
    crossTenant: true,
  });
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

export const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

/**
 * What bookings played in [from, to) earned, per currency, largest first: the total once played, or what was kept
 * after a cancellation (the owner Overview's rule).
 */
export async function earnedByCurrency(from: Date, to: Date, ownerId?: string): Promise<CurrencyAmount[]> {
  const match: Record<string, unknown> = { startAt: { $gte: from, $lt: to } };
  if (ownerId) match.ownerId = new mongoose.Types.ObjectId(ownerId);
  const rows = await Booking.aggregate<{ _id: string; amount: number }>([
    { $match: match },
    {
      $group: {
        _id: '$currency',
        amount: {
          $sum: {
            $switch: {
              branches: [
                { case: { $in: ['$status', PLAYED_STATUSES] }, then: '$total' },
                { case: { $eq: ['$status', 'cancelled'] }, then: { $max: [0, { $subtract: ['$amountPaid', '$amountRefunded'] }] } },
              ],
              default: 0,
            },
          },
        },
      },
    },
  ]).option({ crossTenant: true });
  return rows
    .filter((r) => r.amount > 0)
    .map((r) => ({ currency: r._id, amount: r.amount }))
    .sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency));
}

export const personJson = (u: { _id: unknown; name?: string | null; email?: string | null; phone?: string | null }): AdminPersonJson => ({
  id: String(u._id),
  name: u.name ?? '',
  email: u.email ?? null,
  phone: u.phone ?? null,
});

/** Active owner-role members of each owner, longest-standing first. */
export async function ownerContacts(ownerIds: readonly string[]): Promise<Map<string, AdminPersonJson[]>> {
  const role = await systemRole('owner');
  const members = await Membership.find({ ownerId: { $in: ownerIds }, roleId: role._id, status: 'active' })
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }, { name: 1, email: 1, phone: 1 }).lean();
  const byId = new Map(users.map((u) => [String(u._id), personJson(u)]));
  const out = new Map<string, AdminPersonJson[]>();
  for (const m of members) {
    const person = byId.get(String(m.userId));
    if (!person) continue;
    const list = out.get(String(m.ownerId)) ?? [];
    list.push(person);
    out.set(String(m.ownerId), list);
  }
  return out;
}

type OwnerLean = { _id: unknown; name: string; country: string; defaultCurrency: string; status: string; createdAt: Date };

/** List rows for `owners`, in the given order. */
export async function ownerRows(owners: OwnerLean[], now: Date): Promise<AdminOwnerRowJson[]> {
  if (owners.length === 0) return [];
  const ids = owners.map((o) => String(o._id));
  const [venueRows, bookings, contacts] = await Promise.all([
    Venue.aggregate<{ _id: unknown; total: number; published: number }>([
      { $match: { ownerId: { $in: oids(ids) } } },
      { $group: { _id: '$ownerId', total: { $sum: 1 }, published: { $sum: { $cond: ['$published', 1, 0] } } } },
    ]),
    bookingCounts(periodStart(now), now, ids),
    ownerContacts(ids),
  ]);
  const venues = new Map(venueRows.map((r) => [String(r._id), r]));
  return owners.map((o) => {
    const id = String(o._id);
    return {
      id,
      name: o.name,
      country: o.country,
      currency: o.defaultCurrency,
      status: o.status as OwnerStatus,
      createdAt: o.createdAt.toISOString(),
      contact: contacts.get(id)?.[0] ?? null,
      venues: venues.get(id)?.total ?? 0,
      publishedVenues: venues.get(id)?.published ?? 0,
      recentBookings: bookings.get(id) ?? 0,
    };
  });
}
