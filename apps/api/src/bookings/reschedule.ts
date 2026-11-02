import {
  MOVABLE,
  pickSlots,
  playerRescheduleRefusal,
  type AddonLine,
  type BookingStatus,
  type ReschedulePolicy,
} from '@booking/shared';
import { runInTransaction } from '../db';
import { AppError } from '../errors';
import { offeredAddons } from '../addons/offered';
import { lockAddon } from '../addons/guards';
import { noticeBooking } from '../notifications/outbox';
import { inWindow, loadDay, sourcesWithout } from '../schedule/load';
import type { AppServices } from '../services';
import { logActivity } from '../tenancy/activityLog.model';
import type { TenantContext } from '../tenancy/context';
import { lockTurf } from '../venues/guards';
import { Turf, type TurfDoc } from '../venues/turf.model';
import type { VenueDoc } from '../venues/venue.model';
import { Booking, holdingFilter, type BookingDoc } from './booking.model';
import { assertSeriesAnswered } from './cancel';
import { expireStaleHolds, keyHas, lockSlots, overlapping, rangeOf, slotTaken, stockInUse } from './create';
import { SlotLock } from './slotLock.model';
import { invalidTransition } from './transition';

export type Mover = { kind: 'player'; userId: string } | { kind: 'staff'; t: TenantContext };

export type MoveTarget = { venue: VenueDoc; turf: TurfDoc; date: string; startAts: Date[] };

const refused = (status: number, code: string, message: string) => new AppError(status, code, message);

const PLAYER_REFUSALS = {
  reschedule_not_allowed: 'This venue does not let players move this booking',
  reschedule_too_late: 'It is too late to move this booking',
  reschedule_limit: 'This booking cannot be moved again',
} as const;

const unitsOf = (line: AddonLine) => (line.pricingType === 'per_unit' ? line.quantity : 1);

/** Who may move the booking now, before any slot is looked at. Throws what rescheduleBooking would. */
export async function assertMovable(booking: BookingDoc, by: Mover['kind'], now: Date): Promise<void> {
  if (!MOVABLE.includes(booking.status as BookingStatus)) throw invalidTransition(booking.status);
  if (by === 'player') {
    if (booking.seriesId) throw refused(409, 'reschedule_not_allowed', 'A game of a series is moved by the venue');
    const policy = (booking.policySnapshot.reschedule ?? null) as ReschedulePolicy | null;
    const why = playerRescheduleRefusal(policy, booking.startAt, booking.playerMoves ?? 0, now);
    if (why) throw refused(409, why, PLAYER_REFUSALS[why]);
  } else {
    await assertSeriesAnswered(booking);
    if (now >= booking.endAt) throw refused(409, 'too_late', 'This booking is already over');
  }
}

/**
 * Moves a booking to other slots of the same length at its venue, in one transaction: lockTurf on
 * the old and the new turf (in id order), the new slots checked free, the slot locks swapped. The
 * price, add-ons, coupon, fee and payments stay as they were; each new slot takes the price of the
 * slot it replaces. A player moves within the policy frozen on the booking, on the same turf, and
 * only to slots the grid prices no higher; staff move any time before the end, to any turf.
 */
export async function rescheduleBooking(
  booking: BookingDoc,
  by: Mover,
  target: MoveTarget,
  deps: { services: AppServices },
): Promise<BookingDoc> {
  const now = deps.services.now();
  const ownerId = String(booking.ownerId);
  const { venue, turf, date, startAts } = target;
  const staff = by.kind === 'staff';
  await assertMovable(booking, by.kind, now);
  if (String(venue._id) !== String(booking.venueId)) throw refused(400, 'other_venue', 'A booking moves within its venue');
  if (!staff && String(turf._id) !== String(booking.turfId)) {
    throw refused(400, 'turf_change_not_allowed', 'Pick a time on the same court');
  }

  const { day, settings } = await loadDay(ownerId, venue, turf, date, now, sourcesWithout(booking._id));
  if (!inWindow(date, now, venue.timezone, settings.bookingWindowDays)) {
    throw refused(400, 'outside_window', 'That date cannot be booked yet');
  }
  const picked = pickSlots(day, startAts, { now, allowInProgress: staff });
  const old = [...booking.slots].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const length = (s: { startAt: Date; endAt: Date }[]) => s.reduce((n, x) => n + x.endAt.getTime() - x.startAt.getTime(), 0);
  if (picked.length !== old.length || length(picked) !== length(old)) {
    throw refused(400, 'reschedule_length', 'Pick slots of the same length as the booking');
  }
  const range = rangeOf(picked);
  if (String(turf._id) === String(booking.turfId) && range.startAt.getTime() === booking.startAt.getTime()) {
    throw refused(400, 'reschedule_same_slots', 'Pick a different time');
  }
  if (!staff && picked.reduce((n, s) => n + (s.price ?? 0), 0) > booking.subtotal) {
    throw refused(409, 'reschedule_price_higher', 'Those slots cost more than this booking; ask the venue to move it');
  }
  const slots = picked.map((s, i) => ({ startAt: s.startAt, endAt: s.endAt, price: old[i]!.price }));

  const lines = booking.addons as AddonLine[];
  const offered = await offeredAddons(ownerId, venue, turf);
  const stocked = [...new Set(lines.filter((l) => offered.some((o) => o.addonId === l.addonId && o.stock !== null)).map((l) => l.addonId))].sort();
  const turfIds = [...new Set([String(booking.turfId), String(turf._id)])].sort();
  const before = { turfId: String(booking.turfId), businessDate: booking.businessDate, startAt: booking.startAt.toISOString(), endAt: booking.endAt.toISOString() };
  const previousTurf = String(booking.turfId) === String(turf._id) ? turf : await Turf.findOne({ ownerId, _id: booking.turfId });

  try {
    return await runInTransaction(async (session) => {
      for (const id of turfIds) await lockTurf({ ownerId }, id, now, session);
      const current = await Booking.findOne({ ownerId, _id: booking._id }).session(session);
      if (!current) throw new AppError(404, 'not_found', 'Booking not found');
      // Moved or answered since the caller loaded it: start over from what it is now.
      if (current.rescheduleCount !== booking.rescheduleCount) throw refused(409, 'booking_changed', 'This booking just changed; reload it');
      if (!MOVABLE.includes(current.status as BookingStatus)) throw invalidTransition(current.status);

      await expireStaleHolds(ownerId, turf._id, range, now, session, booking._id);
      const clash = await Booking.exists({
        ownerId,
        turfId: turf._id,
        _id: { $ne: booking._id },
        ...overlapping(range),
        ...holdingFilter(now),
      }).session(session);
      if (clash) throw slotTaken();

      for (const addonId of stocked) await lockAddon({ ownerId }, addonId, now, session);
      const inUse = await stockInUse(ownerId, venue, stocked, range, now, session, booking._id);
      for (const addonId of stocked) {
        const stock = offered.find((o) => o.addonId === addonId)!.stock!;
        const mine = lines.filter((l) => l.addonId === addonId).reduce((n, l) => n + unitsOf(l), 0);
        if ((inUse[addonId] ?? 0) + mine > stock) {
          throw new AppError(409, 'addon_out_of_stock', 'An add-on of this booking is sold out at that time', { addonId });
        }
      }

      await SlotLock.deleteMany({ ownerId, bookingId: booking._id }, { session });
      await lockSlots(ownerId, turf._id, booking._id, slots, session);
      const moved = await Booking.findOneAndUpdate(
        { ownerId, _id: booking._id, status: current.status, rescheduleCount: current.rescheduleCount },
        {
          $set: { turfId: turf._id, businessDate: date, startAt: range.startAt, endAt: range.endAt, slots, rescheduledAt: now },
          $inc: { rescheduleCount: 1, ...(staff ? {} : { playerMoves: 1 }) },
        },
        { session, new: true },
      );
      if (!moved) throw refused(409, 'booking_changed', 'This booking just changed; reload it');

      const userId = staff ? by.t.userId : by.userId;
      await logActivity(
        { ownerId, userId },
        {
          action: 'booking.rescheduled',
          entity: 'booking',
          entityId: String(booking._id),
          venueId: String(booking.venueId),
          before,
          after: { turfId: String(turf._id), businessDate: date, startAt: range.startAt.toISOString(), endAt: range.endAt.toISOString(), by: by.kind },
        },
        now,
        session,
      );
      const notice = {
        repeatKey: `move${moved.rescheduleCount}`,
        previous: { turfName: previousTurf?.name ?? turf.name, startAt: before.startAt, endAt: before.endAt },
      };
      await noticeBooking('booking_rescheduled', moved, now, session, notice);
      if (!staff) await noticeBooking('staff_booking_rescheduled', moved, now, session, notice);
      return moved;
    });
  } catch (err) {
    if (keyHas(err, 'startAt')) throw slotTaken();
    throw err;
  }
}
