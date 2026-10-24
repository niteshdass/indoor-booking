import type { ClientSession } from 'mongoose';
import { SLOT_FREEING_STATUSES, canTransition, type BookingStatus } from '@booking/shared';
import { AppError } from '../errors';
import { logActivity, logSystemActivity } from '../tenancy/activityLog.model';
import { tenantRepo } from '../tenancy/repo';
import type { TenantContext } from '../tenancy/context';
import { Booking, type BookingDoc } from './booking.model';
import { SlotLock } from './slotLock.model';

/** Who acts: a member, or (null userId) a player or guest whose changes are logged as system activity. */
export type Actor = { ownerId: string; userId: string | null };

export const invalidTransition = (status: string) =>
  new AppError(409, 'invalid_transition', `This booking is already ${status}`);

/** The booking, if it belongs to this tenant and its venue is in the member's scope; else 404. */
export async function scopedBooking(t: TenantContext, bookingId: string): Promise<BookingDoc> {
  const booking = await tenantRepo(Booking, t, { venueField: 'venueId' }).findById(bookingId);
  if (!booking) throw new AppError(404, 'not_found', 'Booking not found');
  return booking;
}

/**
 * Moves a booking to `to` with a conditional update on its current status, so when two staff act
 * at once the loser matches nothing and gets 409. Frees the slot locks for freeing statuses and
 * logs `booking.<to>`. Call inside the transaction that carries `session`.
 */
export async function transition(
  t: Actor,
  booking: BookingDoc,
  to: BookingStatus,
  at: Date,
  session: ClientSession,
  extra: Record<string, unknown> = {},
  /** Extra fields for the activity log's `after` only. */
  logExtra: Record<string, unknown> = {},
): Promise<BookingDoc> {
  const from = booking.status as BookingStatus;
  if (!canTransition(from, to)) throw invalidTransition(from);
  const updated = await Booking.findOneAndUpdate(
    { ownerId: t.ownerId, _id: booking._id, status: from },
    { $set: { status: to, ...extra } },
    { session, new: true },
  );
  if (!updated) {
    const current = await Booking.findOne({ ownerId: t.ownerId, _id: booking._id }, { status: 1 }).session(session);
    throw invalidTransition(current?.status ?? from);
  }
  if (SLOT_FREEING_STATUSES.includes(to)) {
    await SlotLock.deleteMany({ ownerId: t.ownerId, bookingId: booking._id }, { session });
  }
  const entry = {
    action: `booking.${to}`,
    entity: 'booking',
    entityId: booking.id as string,
    venueId: String(booking.venueId),
    before: { status: from },
    after: { status: to, ...extra, ...logExtra },
  };
  if (t.userId) await logActivity({ ownerId: t.ownerId, userId: t.userId }, entry, at, session);
  else await logSystemActivity(t.ownerId, entry, at, session);
  return updated;
}
