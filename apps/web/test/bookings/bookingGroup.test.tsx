import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import { mockApi } from '../helpers/api';
import { setAccessToken } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import type { BookingJson, PublicUser } from '../../src/lib/types';

const player: PublicUser = { id: 'u1', name: 'Pat', email: 'p@x.com', emailVerified: true, phone: null, hasPassword: true, hasGoogle: false };

const booking = (id: string, date: string) =>
  ({
    id,
    reference: `REF-${id}`,
    venueId: 'v1',
    turfId: 't1',
    businessDate: date,
    slots: [{ startAt: `${date}T13:00:00.000Z`, endAt: `${date}T14:00:00.000Z`, price: 1400 }],
    addons: [],
    currency: 'BDT',
    subtotal: 1400,
    addonsTotal: 0,
    total: 1400,
    advanceRequired: 0,
    amountPaid: 0,
    amountRefunded: 0,
    status: 'confirmed',
    paymentStatus: 'unpaid',
    holdExpiresAt: null,
    source: 'online',
    playerId: 'u1',
    guest: null,
    seriesId: null,
    groupId: 'g1',
    venue: { slug: 'arena-one', name: 'Arena One', address: 'x', city: 'Dhaka', timezone: 'Asia/Dhaka' },
    turf: { name: 'Court 1' },
  }) as unknown as BookingJson;

beforeEach(() => {
  setAccessToken(null);
  return i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('booking page, several days', () => {
  it('lists the other days booked together, each linking to its booking', async () => {
    mockApi([
      {
        path: '/me/bookings/b1',
        body: { booking: booking('b1', '2026-11-02'), refunds: [], group: [booking('b2', '2026-11-03'), booking('b3', '2026-11-04')] },
      },
    ]);
    renderApp('/me/bookings/b1?new=1', { user: player });
    const section = await screen.findByRole('region', { name: en.booking.groupTitle });
    expect(within(section).getByText(/3 bookings made in one go/)).toBeInTheDocument();
    const links = within(section).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/me/bookings/b2', '/me/bookings/b3']);
    expect(within(section).getByText(/Nov 3/)).toBeInTheDocument();
  });

  it('shows nothing extra for a single booking', async () => {
    mockApi([{ path: '/me/bookings/b1', body: { booking: { ...booking('b1', '2026-11-02'), groupId: null }, refunds: [], group: [] } }]);
    renderApp('/me/bookings/b1', { user: player });
    expect(await screen.findByText('REF-b1')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: en.booking.groupTitle })).not.toBeInTheDocument();
  });

  it('has the strings in ru', () => {
    expect(ru.booking).toHaveProperty('groupTitle');
    for (const k of ['groupNote_one', 'groupNote_few', 'groupNote_many', 'groupNote_other']) expect(ru.booking).toHaveProperty(k);
  });
});
