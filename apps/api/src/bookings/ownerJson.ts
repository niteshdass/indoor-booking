import { User } from '../auth/user.model';
import { Turf } from '../venues/turf.model';
import { bookingJson, type BookingDoc } from './booking.model';

export type OwnerBooking = ReturnType<typeof bookingJson> & {
  customer: { name: string; phone: string | null; email: string | null } | null;
  turf: { name: string } | null;
};

/** Booking JSON plus the customer and turf name, for owner-facing responses. One `$in` query each for the whole list. */
export async function ownerBookingsJson(bookings: BookingDoc[]): Promise<OwnerBooking[]> {
  if (bookings.length === 0) return [];
  const playerIds = [...new Set(bookings.filter((b) => b.playerId).map((b) => String(b.playerId)))];
  const turfIds = [...new Set(bookings.map((b) => String(b.turfId)))];
  const [users, turfs] = await Promise.all([
    playerIds.length ? User.find({ _id: { $in: playerIds } }) : [],
    Turf.find({ _id: { $in: turfIds } }).setOptions({ crossTenant: true }),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const turfById = new Map(turfs.map((t) => [String(t._id), t]));
  return bookings.map((b) => {
    const u = b.playerId ? userById.get(String(b.playerId)) : undefined;
    const t = turfById.get(String(b.turfId));
    const customer = b.playerId
      ? u ? { name: u.name, phone: u.phone ?? null, email: u.email ?? null } : null
      : b.guest ? { name: b.guest.name, phone: b.guest.phone, email: null } : null;
    return { ...bookingJson(b), customer, turf: t ? { name: t.name } : null };
  });
}

export async function ownerBookingJson(b: BookingDoc): Promise<OwnerBooking> {
  return (await ownerBookingsJson([b]))[0]!;
}
