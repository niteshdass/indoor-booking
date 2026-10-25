import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Locale } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { makeTestServices, type TestServices } from '../helpers/testServices';
import { seedOwner, addMember } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Booking, type BookingDoc } from '../../src/bookings/booking.model';
import { Notification } from '../../src/notifications/notification.model';
import { noticeBooking } from '../../src/notifications/outbox';
import { renderNotice, type NoticeData, type NoticeEvent } from '../../src/notifications/templates';
import { runInTransaction } from '../../src/db';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init(), Turf.init(), Booking.init(), Notification.init()]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const cross = { crossTenant: true };
const SERIES_EVENTS: NoticeEvent[] = ['series_requested', 'series_accepted', 'series_declined', 'series_created', 'series_games_cancelled'];

const base: NoticeData = {
  bookingId: 'b1',
  reference: 'REF1',
  venueName: 'Arena',
  turfName: 'Court 1',
  timezone: 'Asia/Dhaka',
  startAt: '2026-01-05T12:00:00.000Z',
  endAt: '2026-01-05T13:00:00.000Z',
  currency: 'BDT',
  ownerId: 'o1',
  seriesId: 's1',
  games: ['2026-01-05T12:00:00.000Z', '2026-01-12T12:00:00.000Z', '2026-01-19T12:00:00.000Z'],
  skipped: [{ date: '2026-01-26', reason: 'taken' }],
  kept: ['2026-02-02T12:00:00.000Z'],
};

describe('renderNotice series events', () => {
  it('renders every series event in en and ru with the dates in venue time', () => {
    for (const event of SERIES_EVENTS) {
      for (const locale of ['en', 'ru'] as Locale[]) {
        const msg = renderNotice(event, locale, { ...base, kept: undefined }, 'https://app.test');
        expect(msg.subject.length).toBeGreaterThan(0);
        expect(msg.sms.length).toBeGreaterThan(0);
        // 12:00Z is 18:00 in Dhaka; one line per game.
        const lines = msg.text.split('\n').filter((l) => /18:00|6:00/.test(l));
        expect(lines).toHaveLength(base.games!.length);
      }
    }
  });

  it('links staff to the series page and players to their bookings', () => {
    expect(renderNotice('series_requested', 'en', base, 'https://app.test').text).toContain('https://app.test/owner/o1/series/s1');
    expect(renderNotice('series_games_cancelled', 'en', { ...base, toStaff: true }, 'https://app.test').text).toContain(
      'https://app.test/owner/o1/series/s1',
    );
    expect(renderNotice('series_accepted', 'en', base, 'https://app.test').text).toContain('https://app.test/me/bookings');
    expect(renderNotice('series_games_cancelled', 'en', base, 'https://app.test').text).toContain('https://app.test/me/bookings');
  });

  it('ru series_declined has no English words from the en template', () => {
    const en = renderNotice('series_declined', 'en', { ...base, reason: 'Closed' }, 'https://app.test');
    const ru = renderNotice('series_declined', 'ru', { ...base, reason: 'Closed' }, 'https://app.test');
    const noUrl = (t: string) => t.replace(/https?:\S+/g, '').toLowerCase();
    const words = new Set(noUrl(en.text).match(/[a-z]{4,}/g));
    for (const w of noUrl(ru.text).match(/[a-z]{4,}/g) ?? []) {
      if (['closed', 'arena', 'court'].includes(w) || w.startsWith('ref')) continue;
      expect(words.has(w), w).toBe(false);
    }
    expect(ru.text).toMatch(/[а-я]/i);
  });

  it('moreGames shows +N more / ещё N', () => {
    expect(renderNotice('series_created', 'en', { ...base, moreGames: 12 }, 'https://app.test').text).toContain('+12 more');
    expect(renderNotice('series_created', 'ru', { ...base, moreGames: 12 }, 'https://app.test').text).toContain('ещё 12');
  });

  it('translates skipped and kept dates with their reason', () => {
    const en = renderNotice('series_created', 'en', base, 'https://app.test').text;
    const ru = renderNotice('series_created', 'ru', base, 'https://app.test').text;
    expect(en).toMatch(/already booked/i);
    expect(ru).toMatch(/занят/i);
    expect(en).toContain('Feb');
  });
});

describe('noticeBooking series recipients', () => {
  let services: TestServices;
  let owner: Awaited<ReturnType<typeof seedOwner>>;
  let venueId: string;
  let turfId: string;
  let seq = 0;

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
      ...[Venue, Turf, Booking, Notification].map((m) => (m as typeof Venue).deleteMany({}).setOptions(cross)),
    ]);
    services = makeTestServices();
    owner = await seedOwner(services);
    venueId = (await seedVenue(owner.ownerId)).id as string;
    turfId = (await seedTurf(owner.ownerId, venueId)).id as string;
  });

  async function seedBooking(over: Record<string, unknown> = {}): Promise<BookingDoc> {
    seq += 1;
    const startAt = new Date('2026-01-05T12:00:00Z');
    const endAt = new Date('2026-01-05T13:00:00Z');
    return Booking.create({
      ownerId: owner.ownerId, venueId, turfId, reference: `SREF${seq}`, businessDate: '2026-01-05', startAt, endAt,
      slots: [{ startAt, endAt, price: 5000 }], currency: 'BDT', subtotal: 5000, addonsTotal: 0, total: 5000,
      advanceRequired: 0, status: 'confirmed', paymentStatus: 'unpaid', source: 'online', policySnapshot: {}, ...over,
    });
  }
  const notice = (event: NoticeEvent, booking: BookingDoc, extra?: Parameters<typeof noticeBooking>[4]) =>
    runInTransaction((s) => noticeBooking(event, booking, services.now(), s, extra));
  const rows = () => Notification.find({}).setOptions(cross).sort({ _id: 1 });
  const seriesId = '65a000000000000000000001';

  it('series_requested goes to staff who can confirm at that venue', async () => {
    const otherVenue = (await seedVenue(owner.ownerId)).id as string;
    const manager = await addMember(services, owner.ownerId, { roleKey: 'manager', venueIds: [venueId] });
    await addMember(services, owner.ownerId, { roleKey: 'staff', venueIds: 'all' });
    await addMember(services, owner.ownerId, { roleKey: 'manager', venueIds: [otherVenue] });
    const booking = await seedBooking({ guest: { name: 'Gus', phone: '+8801811111111' } });
    await notice('series_requested', booking, { seriesId, games: ['2026-01-05T12:00:00.000Z'] });
    const all = await rows();
    const emails = (await User.find({ _id: { $in: [owner.userId, manager.userId] } })).map((u) => u.email).sort();
    expect(all.map((r) => r.to).sort()).toEqual(emails);
    expect(all[0]!.data).toMatchObject({ seriesId, ownerId: String(owner.ownerId), games: ['2026-01-05T12:00:00.000Z'] });
  });

  it('series_games_cancelled to staff when the player cancelled, to the player when staff did', async () => {
    const p = await User.create({ name: 'Pat', email: 'pat@x.test', emailVerified: true });
    const booking = await seedBooking({ playerId: p._id });
    await notice('series_games_cancelled', booking, { seriesId, games: ['2026-01-05T12:00:00.000Z'], toStaff: true });
    expect((await rows()).map((r) => r.to)).toEqual([(await User.findById(owner.userId))!.email]);
    await Notification.deleteMany({}).setOptions(cross);
    await notice('series_games_cancelled', booking, { seriesId, games: ['2026-01-05T12:00:00.000Z'], toStaff: false });
    expect((await rows()).map((r) => r.to)).toEqual(['pat@x.test']);
  });

  it('series_created for a group goes to its phone', async () => {
    const booking = await seedBooking({ guest: { name: 'Gus', phone: '+8801811111111' } });
    await notice('series_created', booking, { seriesId, games: ['2026-01-05T12:00:00.000Z'] });
    expect((await rows()).map((r) => [r.channel, r.to])).toEqual([['sms', '+8801811111111']]);
  });
});
