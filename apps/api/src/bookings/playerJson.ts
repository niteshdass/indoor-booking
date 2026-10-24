import { Venue } from '../venues/venue.model';
import { Turf } from '../venues/turf.model';
import { bookingJson, type BookingDoc } from './booking.model';

export type PlayerPlace = {
  venue: { slug: string; name: string; address: string; city: string; timezone: string };
  turf: { name: string };
};

export type PlayerBooking = ReturnType<typeof bookingJson> & {
  venue: PlayerPlace['venue'] | null;
  turf: PlayerPlace['turf'] | null;
};

/** Booking JSON plus the venue and turf names, for player-facing responses. Two `$in` queries for the whole list. */
export async function playerBookingsJson(bookings: BookingDoc[]): Promise<PlayerBooking[]> {
  if (bookings.length === 0) return [];
  const ids = (key: 'venueId' | 'turfId') => [...new Set(bookings.map((b) => String(b[key])))];
  const [venues, turfs] = await Promise.all([
    Venue.find({ _id: { $in: ids('venueId') } }).setOptions({ crossTenant: true }),
    Turf.find({ _id: { $in: ids('turfId') } }).setOptions({ crossTenant: true }),
  ]);
  const venueById = new Map(venues.map((v) => [String(v._id), v]));
  const turfById = new Map(turfs.map((t) => [String(t._id), t]));
  return bookings.map((b) => {
    const v = venueById.get(String(b.venueId));
    const t = turfById.get(String(b.turfId));
    return {
      ...bookingJson(b),
      venue: v ? { slug: v.slug, name: v.name, address: v.address, city: v.city, timezone: v.timezone } : null,
      turf: t ? { name: t.name } : null,
    };
  });
}

export async function playerBookingJson(b: BookingDoc): Promise<PlayerBooking> {
  return (await playerBookingsJson([b]))[0]!;
}
