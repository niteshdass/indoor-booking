import mongoose, { type ClientSession } from 'mongoose';
import { FEE_OWING_STATUSES, STRIPE_PAYOUT_HOLD_MS, type CurrencyAmount, type PlatformBalanceJson } from '@booking/shared';
import { Booking } from '../bookings/booking.model';
import { PlatformPayout } from './payout.model';

const oids = (ids: readonly string[]) => ids.map((id) => new mongoose.Types.ObjectId(id));

type Key = { ownerId: unknown; currency: string };
const keyOf = (k: Key) => `${String(k.ownerId)}:${k.currency}`;

/**
 * Fees owed per owner and currency, and payouts per owner, currency and status. Pending Stripe payouts
 * created before `staleBefore` are left out.
 */
async function totals(ownerIds: readonly string[], statuses: readonly string[], staleBefore: Date | null, session?: ClientSession) {
  const ownerId = { $in: oids(ownerIds) };
  // One after the other: operations in a transaction must not run in parallel on its session.
  const owed = await Booking.aggregate<{ _id: Key; amount: number }>([
    { $match: { ownerId, platformFee: { $ne: null }, status: { $in: [...FEE_OWING_STATUSES] } } },
    { $group: { _id: { ownerId: '$ownerId', currency: '$currency' }, amount: { $sum: '$platformFee.amount' } } },
  ]).session(session ?? null);
  const payouts = await PlatformPayout.aggregate<{ _id: Key & { status: string }; amount: number }>([
    {
      $match: {
        ownerId,
        status: { $in: [...statuses] },
        ...(staleBefore ? { $nor: [{ method: 'stripe', status: 'pending', createdAt: { $lt: staleBefore } }] } : {}),
      },
    },
    { $group: { _id: { ownerId: '$ownerId', currency: '$currency', status: '$status' }, amount: { $sum: '$amount' } } },
  ]).session(session ?? null);
  return { owed, payouts };
}

/**
 * The owner's platform-fee balance per currency that has any fee or payout, largest balance first.
 * Pending payouts leave the balance alone but hold back what can still be paid; a pending Stripe payout
 * only until STRIPE_PAYOUT_HOLD_MS after it was created.
 */
export async function platformBalances(ownerId: string, now: Date, session?: ClientSession): Promise<PlatformBalanceJson[]> {
  const staleBefore = new Date(now.getTime() - STRIPE_PAYOUT_HOLD_MS);
  const { owed, payouts } = await totals([ownerId], ['pending', 'confirmed'], staleBefore, session);
  const rows = new Map<string, PlatformBalanceJson>();
  const row = (currency: string) => {
    let r = rows.get(currency);
    if (!r) rows.set(currency, (r = { currency, owed: 0, paid: 0, pending: 0, balance: 0, payable: 0 }));
    return r;
  };
  for (const o of owed) row(o._id.currency).owed += o.amount;
  for (const p of payouts) row(p._id.currency)[p._id.status === 'confirmed' ? 'paid' : 'pending'] += p.amount;
  return [...rows.values()]
    .filter((r) => r.owed !== 0 || r.paid !== 0 || r.pending !== 0)
    .map((r) => {
      const balance = r.owed - r.paid;
      return { ...r, balance, payable: Math.max(0, balance - r.pending) };
    })
    .sort((x, y) => y.balance - x.balance || x.currency.localeCompare(y.currency));
}

/** Each owner's non-zero balances (owed − confirmed payouts; negative is a credit), for the admin owner list. */
export async function balancesByOwner(ownerIds: string[]): Promise<Map<string, CurrencyAmount[]>> {
  const out = new Map<string, CurrencyAmount[]>();
  if (ownerIds.length === 0) return out;
  const { owed, payouts } = await totals(ownerIds, ['confirmed'], null);
  const sums = new Map<string, Key & { amount: number }>();
  const add = (k: Key, amount: number) => {
    const s = sums.get(keyOf(k)) ?? { ownerId: k.ownerId, currency: k.currency, amount: 0 };
    s.amount += amount;
    sums.set(keyOf(k), s);
  };
  for (const o of owed) add(o._id, o.amount);
  for (const p of payouts) add(p._id, -p.amount);
  for (const s of sums.values()) {
    if (s.amount === 0) continue;
    const id = String(s.ownerId);
    out.set(id, [...(out.get(id) ?? []), { currency: s.currency, amount: s.amount }]);
  }
  for (const list of out.values()) list.sort((x, y) => y.amount - x.amount || x.currency.localeCompare(y.currency));
  return out;
}
