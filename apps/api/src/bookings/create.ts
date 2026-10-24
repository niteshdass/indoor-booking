import type { ClientSession } from 'mongoose';
import {
  BookingQuoteError,
  HOLD_MINUTES,
  InvalidMoneyError,
  assertMinor,
  initialStatus,
  paymentStatusFor,
  pickSlots,
  quoteBooking,
  type AddonLine,
  type AddonSelection,
  type BookingQuote,
  type ComputedSlot,
  type EffectiveSettings,
  type OfferedAddon,
} from '@booking/shared';
import { isDuplicateKeyError, runInTransaction } from '../db';
import { AppError } from '../errors';
import { offeredAddons } from '../addons/offered';
import { lockAddon } from '../addons/guards';
import { inWindow, loadDay } from '../schedule/load';
import { lockTurf } from '../venues/guards';
import type { TurfDoc } from '../venues/turf.model';
import type { VenueDoc } from '../venues/venue.model';
import { Booking, holdingFilter, type BookingDoc } from './booking.model';
import { Payment } from './payment.model';
import { newReference } from './reference';
import { SlotLock } from './slotLock.model';

type QuoteInput = {
  venue: VenueDoc;
  turf: TurfDoc;
  date: string;
  startAts: Date[];
  selection: AddonSelection[];
  source: 'online' | 'walkin';
  now: Date;
};

export type CreateBookingInput = QuoteInput & {
  who: { playerId: string | null; guest: { name: string; phone: string } | null; createdBy: string | null };
  cash?: { amount: number; recordedBy: string };
};

const REFERENCE_ATTEMPTS = 5;

const slotTaken = () => new AppError(409, 'slot_taken', 'That slot was just booked');

const keyHas = (err: unknown, key: string) =>
  isDuplicateKeyError(err) && Object.hasOwn((err as { keyPattern?: object }).keyPattern ?? {}, key);

type Range = { startAt: Date; endAt: Date };
const rangeOf = (slots: Range[]): Range => ({ startAt: slots[0]!.startAt, endAt: slots[slots.length - 1]!.endAt });
const overlapping = (r: Range) => ({ startAt: { $lt: r.endAt }, endAt: { $gt: r.startAt } });

/** The selected add-ons that have a stock limit. */
const limited = (offered: OfferedAddon[], selection: AddonSelection[]) =>
  selection.filter((s) => offered.some((o) => o.addonId === s.addonId && o.stock !== null)).map((s) => s.addonId);

/**
 * Units of each add-on held at the venue (any turf) by bookings overlapping `range`: a per_unit
 * line counts its quantity, any other line 1.
 */
async function stockInUse(
  ownerId: string,
  venue: VenueDoc,
  addonIds: string[],
  range: Range,
  now: Date,
  session: ClientSession | null = null,
): Promise<Record<string, number>> {
  if (addonIds.length === 0) return {};
  const bookings = await Booking.find(
    { ownerId, venueId: venue._id, ...overlapping(range), 'addons.addonId': { $in: addonIds }, ...holdingFilter(now) },
    { addons: 1 },
  )
    .session(session)
    .lean();
  const inUse: Record<string, number> = {};
  for (const b of bookings) {
    for (const line of b.addons as AddonLine[]) {
      if (!addonIds.includes(line.addonId)) continue;
      inUse[line.addonId] = (inUse[line.addonId] ?? 0) + (line.pricingType === 'per_unit' ? line.quantity : 1);
    }
  }
  return inUse;
}

async function prepare(input: QuoteInput) {
  const { venue, turf, date, startAts, selection, source, now } = input;
  const ownerId = String(venue.ownerId);
  const { day, settings } = await loadDay(ownerId, venue, turf, date, now);
  if (!inWindow(date, now, venue.timezone, settings.bookingWindowDays)) {
    throw new AppError(400, 'outside_window', 'That date cannot be booked yet');
  }
  const picked = pickSlots(day, startAts, { now, allowInProgress: source === 'walkin' });
  const offered = await offeredAddons(ownerId, venue, turf);
  const inUse = await stockInUse(ownerId, venue, limited(offered, selection), rangeOf(picked), now);
  const paymentPolicy = source === 'online' ? settings.paymentPolicy : null;
  const quote = quoteBooking({ slots: picked, offered, indoor: turf.indoor, selection, inUse, paymentPolicy });
  return { ownerId, settings, picked, offered, paymentPolicy, quote };
}

/** Prices a booking against the live grid. Stock in use is read outside a transaction: a preview only. */
export async function quoteFor(
  input: QuoteInput,
): Promise<{ quote: BookingQuote; settings: EffectiveSettings; picked: ComputedSlot[] }> {
  const { quote, settings, picked } = await prepare(input);
  return { quote, settings, picked };
}

/**
 * Creates a booking in one transaction. lockTurf serializes bookings of a turf and lockAddon the
 * stock of an add-on: a concurrent writer WriteConflicts, withTransaction retries it, and the retry
 * sees the winner. Does not log activity; staff routes do that.
 */
export async function createBooking(input: CreateBookingInput): Promise<BookingDoc> {
  const { venue, turf, selection, source, now, who, cash } = input;
  let prepared: Awaited<ReturnType<typeof prepare>>;
  try {
    prepared = await prepare(input);
  } catch (err) {
    // A slot someone else holds is "just booked", whether we see it here or inside the transaction.
    if (err instanceof BookingQuoteError && err.code === 'slot_unavailable' && err.startAt) {
      const { day } = await loadDay(String(venue.ownerId), venue, turf, input.date, now);
      const slot = day.slots.find((s) => s.startAt.toISOString() === err.startAt);
      if (slot && (slot.status === 'booked' || slot.status === 'pending')) throw slotTaken();
    }
    throw err;
  }
  const { ownerId, settings, picked, offered, paymentPolicy } = prepared;
  const range = rangeOf(picked);
  const lockOwner = { ownerId };

  const attempt = (reference: string) =>
    runInTransaction(async (session) => {
      await lockTurf(lockOwner, turf.id as string, now, session);

      const turfRange = { ownerId, turfId: turf._id, ...overlapping(range) };
      const stale = await Booking.find(
        { ...turfRange, status: 'awaiting_payment', holdExpiresAt: { $lte: now } },
        { _id: 1 },
      ).session(session);
      if (stale.length > 0) {
        const ids = stale.map((b) => b._id);
        await Booking.updateMany({ ownerId, _id: { $in: ids } }, { $set: { status: 'expired' } }, { session });
        await SlotLock.deleteMany({ ownerId, bookingId: { $in: ids } }, { session });
      }

      if (await Booking.exists({ ...turfRange, ...holdingFilter(now) }).session(session)) throw slotTaken();

      const stocked = [...new Set(limited(offered, selection))].sort();
      for (const addonId of stocked) await lockAddon(lockOwner, addonId, now, session);
      const inUse = await stockInUse(ownerId, venue, stocked, range, now, session);
      const quote = quoteBooking({ slots: picked, offered, indoor: turf.indoor, selection, inUse, paymentPolicy });

      const status = initialStatus({ source, guest: who.guest !== null, advanceRequired: quote.advanceRequired });
      let amountPaid = 0;
      if (cash) {
        assertMinor(cash.amount);
        if (cash.amount < 1 || cash.amount > quote.total) {
          throw new InvalidMoneyError(`Cash must be between 1 and ${quote.total}`);
        }
        amountPaid = cash.amount;
      }

      const [booking] = await Booking.create(
        [
          {
            ownerId,
            venueId: venue._id,
            turfId: turf._id,
            reference,
            businessDate: input.date,
            startAt: range.startAt,
            endAt: range.endAt,
            slots: quote.slots,
            addons: quote.addons,
            currency: venue.currency,
            subtotal: quote.subtotal,
            addonsTotal: quote.addonsTotal,
            total: quote.total,
            advanceRequired: quote.advanceRequired,
            amountPaid,
            status,
            paymentStatus: paymentStatusFor(amountPaid, quote.total),
            holdExpiresAt: status === 'awaiting_payment' ? new Date(now.getTime() + HOLD_MINUTES * 60_000) : null,
            source,
            playerId: who.playerId,
            guest: who.guest,
            policySnapshot: { paymentPolicy: settings.paymentPolicy, refundRules: settings.refundRules },
            createdBy: who.createdBy,
          },
        ],
        { session },
      );
      await SlotLock.create(
        quote.slots.map((s) => ({ ownerId, turfId: turf._id, startAt: s.startAt, bookingId: booking!._id })),
        { session, ordered: true },
      );
      if (cash) {
        await Payment.create(
          [
            {
              ownerId,
              venueId: venue._id,
              bookingId: booking!._id,
              method: 'cash',
              amount: cash.amount,
              currency: venue.currency,
              status: 'succeeded',
              recordedBy: cash.recordedBy,
            },
          ],
          { session },
        );
      }
      return booking!;
    });

  // A duplicate key aborts the transaction, so a reference clash reruns the whole of it.
  for (let i = 1; ; i++) {
    try {
      return await attempt(newReference());
    } catch (err) {
      if (keyHas(err, 'reference') && i < REFERENCE_ATTEMPTS) continue;
      if (keyHas(err, 'startAt')) throw slotTaken();
      throw err;
    }
  }
}
