import { describe, expect, it } from 'vitest';
import { bookAgain } from '../../src/bookings/bookAgain';
import type { BookingJson } from '../../src/lib/types';

// Tue 2026-11-03 18:00-20:00 Asia/Dhaka (UTC+6) = 12:00-14:00Z
const booking = (over: Partial<BookingJson> = {}) =>
  ({
    id: 'b1',
    turfId: 't1',
    businessDate: '2026-11-03',
    status: 'completed',
    slots: [
      { startAt: '2026-11-03T13:00:00.000Z', endAt: '2026-11-03T14:00:00.000Z', price: 1000 },
      { startAt: '2026-11-03T12:00:00.000Z', endAt: '2026-11-03T13:00:00.000Z', price: 1000 },
    ],
    venue: { slug: 'arena-one', name: 'Arena One', address: 'x', city: 'Dhaka', timezone: 'Asia/Dhaka' },
    ...over,
  }) as BookingJson;

const query = (href: string) => Object.fromEntries(new URL(href, 'https://x').searchParams);

describe('bookAgain', () => {
  it('links the venue page with the same turf and start times', () => {
    const again = bookAgain(booking(), new Date('2026-11-05T06:00:00.000Z'))!;
    expect(again.href.startsWith('/venues/arena-one?')).toBe(true);
    expect(query(again.href)).toEqual({ turf: 't1', date: '2026-11-10', times: '18:00,19:00' });
    expect(again.date).toBe('2026-11-10');
  });

  it('picks today when it is the same weekday and the game has not started', () => {
    // Tue 2026-11-10 17:00 Dhaka
    expect(bookAgain(booking(), new Date('2026-11-10T11:00:00.000Z'))!.date).toBe('2026-11-10');
    // Tue 2026-11-10 18:00 Dhaka: the start has come
    expect(bookAgain(booking(), new Date('2026-11-10T12:00:00.000Z'))!.date).toBe('2026-11-17');
  });

  it('goes by the venue time zone, not the browser', () => {
    // Mon 2026-11-09 19:00Z is already Tue 01:00 in Dhaka
    expect(bookAgain(booking(), new Date('2026-11-09T19:00:00.000Z'))!.date).toBe('2026-11-10');
  });

  it('a booking still to be played offers the week after it', () => {
    const now = new Date('2026-10-27T06:00:00.000Z');
    expect(bookAgain(booking({ status: 'confirmed' }), now)!.date).toBe('2026-11-10');
    expect(bookAgain(booking({ status: 'cancelled' }), now)!.date).toBe('2026-10-27');
  });

  it('nothing without a venue, slots, or while waiting for payment', () => {
    const now = new Date('2026-11-05T06:00:00.000Z');
    expect(bookAgain(booking({ venue: undefined }), now)).toBeNull();
    expect(bookAgain(booking({ slots: [] }), now)).toBeNull();
    expect(bookAgain(booking({ status: 'awaiting_payment' }), now)).toBeNull();
  });
});
