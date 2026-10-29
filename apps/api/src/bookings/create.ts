import mongoose, { type ClientSession } from 'mongoose';
import {
  AddonQuoteError,
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
import { noticeBooking } from '../notifications/outbox';
import { Booking, holdingFilter, type BookingDoc } from './booking.model';
import { Payment, type PaymentDoc } from './payment.model';
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
  /** Cash taken at creation; an omitted amount means the whole total. */
  cash?: { amount?: number; recordedBy: string };
  /**
   * A card payment link: the booking is held awaiting_payment for LINK_HOLD_MINUTES and a pending
   * `link` payment is inserted. An omitted amount means the whole total.
   */
  card?: { amount?: number; gateway: string; gatewayAccountId: string; gatewayMode: 'test' | 'live' };
  /** Stored on the booking; a second booking with the same key fails on the unique index (keyHas 'requestKey'). */
  requestKey?: string;
  /** Runs inside the creating transaction after the inserts, e.g. to log activity atomically. */
  afterInsert?: (session: ClientSession, booking: BookingDoc, payment: PaymentDoc | null) => Promise<void>;
};

/** Attempts at a fresh booking reference before a duplicate is given up on. */
export const REFERENCE_ATTEMPTS = 5;

/**
 * A Stripe Checkout Session must expire at least 30 minutes after Stripe creates it, and it expires
 * with the hold; the extra 2 minutes cover the transaction and the network before that call.
 */
export const LINK_HOLD_MINUTES = 32;

const slotTaken = () => new AppError(409, 'slot_taken', 'That slot was just booked');

/** A duplicate-key error on an index containing `key`. */
export const keyHas = (err: unknown, key: string) =>
  isDuplicateKeyError(err) && Object.hasOwn((err as { keyPattern?: object }).keyPattern ?? {}, key);

type Range = { startAt: Date; endAt: Date };
export const rangeOf = (slots: Range[]): Range => ({ startAt: slots[0]!.startAt, endAt: slots[slots.length - 1]!.endAt });
export const overlapping = (r: Range) => ({ startAt: { $lt: r.endAt }, endAt: { $gt: r.startAt } });

/** One SlotLock per slot of `bookingId`; the unique {turfId, startAt} index refuses a slot already held. */
export async function lockSlots(
  ownerId: string,
  turfId: unknown,
  bookingId: unknown,
  slots: { startAt: Date }[],
  session: ClientSession,
): Promise<void> {
  await SlotLock.create(
    slots.map((s) => ({ ownerId, turfId, startAt: s.startAt, bookingId })),
    { session, ordered: true },
  );
}

/** The selected add-ons that have a stock limit. */
export const limited = (offered: OfferedAddon[], selection: AddonSelection[]) =>
  selection.filter((s) => offered.some((o) => o.addonId === s.addonId && o.stock !== null)).map((s) => s.addonId);

/**
 * Units of each add-on held at the venue (any turf) by bookings overlapping `range`: a per_unit
 * line counts its quantity, any other line 1.
 */
export async function stockInUse(
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

/**
 * Lazy expiry: lapsed holds overlapping `range` on the turf become expired and free their slot
 * locks. Call under lockTurf. `except` keeps one booking out of the sweep.
 */
export async function expireStaleHolds(
  ownerId: string,
  turfId: unknown,
  range: Range,
  now: Date,
  session: ClientSession,
  except?: unknown,
): Promise<void> {
  const stale = await Booking.find(
    {
      ownerId,
      turfId,
      ...overlapping(range),
      ...(except === undefined ? {} : { _id: { $ne: except } }),
      status: 'awaiting_payment',
      holdExpiresAt: { $lte: now },
    },
    { _id: 1 },
  ).session(session);
  if (stale.length === 0) return;
  const ids = stale.map((b) => b._id);
  await Booking.updateMany({ ownerId, _id: { $in: ids } }, { $set: { status: 'expired' } }, { session });
  await SlotLock.deleteMany({ ownerId, bookingId: { $in: ids } }, { session });
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
  const { venue, turf, selection, source, now, who, cash, card, requestKey, afterInsert } = input;
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

      await expireStaleHolds(ownerId, turf._id, range, now, session);
      const turfRange = { ownerId, turfId: turf._id, ...overlapping(range) };

      if (await Booking.exists({ ...turfRange, ...holdingFilter(now) }).session(session)) throw slotTaken();

      const stocked = [...new Set(limited(offered, selection))].sort();
      for (const addonId of stocked) await lockAddon(lockOwner, addonId, now, session);
      const inUse = await stockInUse(ownerId, venue, stocked, range, now, session);
      const quote = quoteBooking({ slots: picked, offered, indoor: turf.indoor, selection, inUse, paymentPolicy });

      const status = card
        ? 'awaiting_payment'
        : initialStatus({ source, guest: who.guest !== null, advanceRequired: quote.advanceRequired });
      // Nothing to collect on a free booking: cash records no payment, a card link is refused.
      const takeCash = cash !== undefined && (quote.total > 0 || cash.amount !== undefined);
      if (card && quote.total === 0) throw new AppError(400, 'nothing_to_pay', 'This booking has nothing to pay');
      const amountOf = (taken: { amount?: number }) => {
        const amount = taken.amount ?? quote.total;
        assertMinor(amount);
        if (amount < 1 || amount > quote.total) throw new InvalidMoneyError(`Amount must be between 1 and ${quote.total}`);
        return amount;
      };
      const amountPaid = takeCash ? amountOf(cash) : 0;
      const linkAmount = card ? amountOf(card) : 0;
      const holdMinutes = card ? LINK_HOLD_MINUTES : HOLD_MINUTES;

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
            holdExpiresAt: status === 'awaiting_payment' ? new Date(now.getTime() + holdMinutes * 60_000) : null,
            source,
            playerId: who.playerId,
            guest: who.guest,
            policySnapshot: { paymentPolicy: settings.paymentPolicy, refundRules: settings.refundRules },
            createdBy: who.createdBy,
            requestKey,
            // The app clock, not the wall clock: the reminder sweep compares it with startAt.
            createdAt: now,
          },
        ],
        { session },
      );
      await lockSlots(ownerId, turf._id, booking!._id, quote.slots, session);
      const paymentRow = takeCash
        ? { method: 'cash', amount: amountPaid, status: 'succeeded', recordedBy: cash.recordedBy }
        : card
          ? {
              method: 'card',
              kind: 'link',
              amount: linkAmount,
              status: 'pending',
              gateway: card.gateway,
              gatewayAccountId: card.gatewayAccountId,
              gatewayMode: card.gatewayMode,
            }
          : null;
      let payment: PaymentDoc | null = null;
      if (paymentRow) {
        const [created] = await Payment.create(
          [{ ownerId, venueId: venue._id, bookingId: booking!._id, currency: venue.currency, ...paymentRow }],
          { session },
        );
        payment = created as unknown as PaymentDoc;
      }
      // A hold says nothing until its payment confirms it.
      if (status === 'pending') {
        await noticeBooking('booking_pending', booking!, now, session);
        await noticeBooking('staff_new_pending', booking!, now, session);
      } else if (status === 'confirmed') {
        await noticeBooking('booking_confirmed', booking!, now, session);
      }
      await afterInsert?.(session, booking!, payment);
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

/** One booking of a group: a run of consecutive slots on one day of one turf. */
export type GroupItem = { turf: TurfDoc; date: string; startAts: Date[] };

type GroupInput = Omit<QuoteInput, 'source' | 'date' | 'startAts' | 'turf'> & {
  /** Distinct slots; any turfs of the venue, any days, any times, each item booked on its own. */
  items: GroupItem[];
  /** `online` unless staff book a walk-in. */
  source?: 'online' | 'walkin';
};

/** A failure on one item of a group, naming its turf, day and first slot so the player knows which one to drop. */
const itemError = (item: GroupItem, err: unknown): unknown => {
  const where = { turfId: String(item.turf._id), date: item.date, itemStart: item.startAts[0]!.toISOString() };
  if (err instanceof AppError) return new AppError(err.status, err.code, err.message, where);
  if (err instanceof BookingQuoteError) return new AppError(400, err.code, err.message, { ...where, startAt: err.startAt });
  if (err instanceof AddonQuoteError) return new AppError(err.code === 'addon_out_of_stock' ? 409 : 400, err.code, err.message, { ...where, addonId: err.addonId });
  return err;
};

/** The add-ons of `selection` that `turf` offers: one pick of add-ons spans courts that may not all have them. */
const offeredOn = async (ownerId: string, input: GroupInput, turf: TurfDoc, many: boolean) => {
  if (!many) return input.selection;
  const offered = await offeredAddons(ownerId, input.venue, turf);
  return input.selection.filter((s) => offered.some((o) => o.addonId === s.addonId && !o.autoApply));
};

/** Prepares every item of a group in order; the first failure names its item. */
async function prepareGroup(input: GroupInput) {
  const ownerId = String(input.venue.ownerId);
  const many = new Set(input.items.map((i) => String(i.turf._id))).size > 1;
  const items: (Awaited<ReturnType<typeof prepare>> & { item: GroupItem; selection: AddonSelection[] })[] = [];
  for (const item of input.items) {
    try {
      const selection = await offeredOn(ownerId, input, item.turf, many);
      const base = { ...input, turf: item.turf, selection, source: input.source ?? 'online' };
      items.push({ ...(await prepare({ ...base, date: item.date, startAts: item.startAts })), item, selection });
    } catch (err) {
      // Someone else holding a slot is "just booked", as for a single booking.
      if (err instanceof BookingQuoteError && err.code === 'slot_unavailable' && err.startAt) {
        const { day } = await loadDay(ownerId, input.venue, item.turf, item.date, input.now);
        const slot = day.slots.find((s) => s.startAt.toISOString() === err.startAt);
        if (slot && (slot.status === 'booked' || slot.status === 'pending')) throw itemError(item, new AppError(409, 'slot_taken', 'That slot was just booked'));
      }
      throw itemError(item, err);
    }
  }
  return items;
}

/** Prices each item of a group against the live grid; a preview, as quoteFor. */
export async function quoteGroup(
  input: GroupInput,
): Promise<{ items: { turfId: string; date: string; quote: BookingQuote }[]; settings: EffectiveSettings }> {
  const items = await prepareGroup(input);
  return { items: items.map((d) => ({ turfId: String(d.item.turf._id), date: d.item.date, quote: d.quote })), settings: items[0]!.settings };
}

export type CreateGroupInput = GroupInput & {
  who: CreateBookingInput['who'];
  /** Cash taken at creation: each booking's whole total. */
  cash?: { recordedBy: string };
  /**
   * One card payment link for the whole group: every booking is held awaiting_payment for
   * LINK_HOLD_MINUTES with a pending `link` payment of its total, the rows sharing the groupId.
   */
  card?: Omit<NonNullable<CreateBookingInput['card']>, 'amount'>;
  /** Stored on the first booking only (see CreateBookingInput). */
  requestKey?: string;
  /** Runs inside the creating transaction after each booking's inserts. */
  afterInsert?: CreateBookingInput['afterInsert'];
};

/**
 * Books several runs of slots (any turfs of the venue, any days, any times), all or nothing: one transaction
 * under the lockTurf of every turf involved, one booking per item sharing a groupId, each priced on its own
 * with the add-ons its turf offers. A clash on any item books none and names that item. Players book online;
 * staff book walk-ins, optionally taking cash or handing over one payment link.
 */
export async function createBookingGroup(input: CreateGroupInput): Promise<BookingDoc[]> {
  const { venue, now, who, cash, card, requestKey, afterInsert } = input;
  const source = input.source ?? 'online';
  const days = await prepareGroup(input);
  const { ownerId } = days[0]!;
  const lockOwner = { ownerId };
  // Always the same order, so two groups sharing turfs cannot each hold one the other waits on.
  const turfIds = [...new Set(days.map((d) => String(d.item.turf._id)))].sort();

  const attempt = () =>
    runInTransaction(async (session) => {
      for (const id of turfIds) await lockTurf(lockOwner, id, now, session);
      for (const d of days) {
        const range = rangeOf(d.picked);
        const turfId = d.item.turf._id;
        await expireStaleHolds(ownerId, turfId, range, now, session);
        if (await Booking.exists({ ownerId, turfId, ...overlapping(range), ...holdingFilter(now) }).session(session)) {
          throw itemError(d.item, new AppError(409, 'slot_taken', 'That slot was just booked'));
        }
      }

      const stocked = [...new Set(days.flatMap((d) => limited(d.offered, d.selection)))].sort();
      for (const addonId of stocked) await lockAddon(lockOwner, addonId, now, session);
      const groupId = new mongoose.Types.ObjectId();
      const holdExpiresAt = new Date(now.getTime() + (card ? LINK_HOLD_MINUTES : HOLD_MINUTES) * 60_000);
      const bookings: BookingDoc[] = [];
      for (const d of days) {
        const range = rangeOf(d.picked);
        const { turf } = d.item;
        let quote: BookingQuote;
        try {
          const inUse = await stockInUse(ownerId, venue, limited(d.offered, d.selection), range, now, session);
          quote = quoteBooking({ slots: d.picked, offered: d.offered, indoor: turf.indoor, selection: d.selection, inUse, paymentPolicy: d.paymentPolicy });
        } catch (err) {
          throw itemError(d.item, err);
        }
        // Every booking of a link group has something to pay, or the shared link would hold a free one.
        if (card && quote.total === 0) throw itemError(d.item, new AppError(400, 'nothing_to_pay', 'This booking has nothing to pay'));
        const status = card
          ? 'awaiting_payment'
          : initialStatus({ source, guest: who.guest !== null, advanceRequired: quote.advanceRequired });
        const amountPaid = cash && quote.total > 0 ? quote.total : 0;
        const [booking] = await Booking.create(
          [
            {
              ownerId,
              venueId: venue._id,
              turfId: turf._id,
              reference: newReference(),
              businessDate: d.item.date,
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
              holdExpiresAt: status === 'awaiting_payment' ? holdExpiresAt : null,
              source,
              playerId: who.playerId,
              guest: who.guest,
              policySnapshot: { paymentPolicy: d.settings.paymentPolicy, refundRules: d.settings.refundRules },
              createdBy: who.createdBy,
              groupId,
              requestKey: bookings.length === 0 ? requestKey : undefined,
              createdAt: now,
            },
          ],
          { session },
        );
        await lockSlots(ownerId, turf._id, booking!._id, quote.slots, session);
        const paymentRow = amountPaid > 0
          ? { method: 'cash', amount: amountPaid, status: 'succeeded', recordedBy: cash!.recordedBy }
          : card
            ? { method: 'card', kind: 'link', amount: quote.total, status: 'pending', groupId, ...card }
            : null;
        let payment: PaymentDoc | null = null;
        if (paymentRow) {
          const [created] = await Payment.create(
            [{ ownerId, venueId: venue._id, bookingId: booking!._id, currency: venue.currency, ...paymentRow }],
            { session },
          );
          payment = created as unknown as PaymentDoc;
        }
        if (status === 'pending') {
          await noticeBooking('booking_pending', booking!, now, session);
          await noticeBooking('staff_new_pending', booking!, now, session);
        } else if (status === 'confirmed') {
          await noticeBooking('booking_confirmed', booking!, now, session);
        }
        await afterInsert?.(session, booking!, payment);
        bookings.push(booking!);
      }
      return bookings;
    });

  // A duplicate key aborts the transaction, so a reference clash reruns the whole of it.
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (keyHas(err, 'reference') && i < REFERENCE_ATTEMPTS) continue;
      if (keyHas(err, 'startAt')) throw new AppError(409, 'slot_taken', 'That slot was just booked');
      throw err;
    }
  }
}
