import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import { mockApi } from '../helpers/api';
import { setAccessToken } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import type { BookingJson, PublicUser } from '../../src/lib/types';

const player: PublicUser = { id: 'u1', name: 'Pat', email: 'p@x.com', emailVerified: true, phone: null, hasPassword: true, hasGoogle: false };

const booking = (id: string, day: string, over: Partial<BookingJson> = {}) =>
  ({
    id,
    reference: `REF${id}`,
    venueId: 'v1',
    turfId: 't1',
    businessDate: day,
    // 18:00-20:00 Asia/Dhaka = 12:00-14:00Z
    slots: [
      { startAt: `${day}T12:00:00.000Z`, endAt: `${day}T13:00:00.000Z`, price: 1000 },
      { startAt: `${day}T13:00:00.000Z`, endAt: `${day}T14:00:00.000Z`, price: 1000 },
    ],
    addons: [],
    currency: 'BDT',
    subtotal: 2000,
    addonsTotal: 0,
    total: 2000,
    advanceRequired: 1000,
    amountPaid: 0,
    amountRefunded: 0,
    status: 'confirmed',
    paymentStatus: 'unpaid',
    holdExpiresAt: null,
    source: 'online',
    playerId: 'u1',
    guest: null,
    venue: { slug: 'arena-one', name: `Arena ${id}`, address: 'x', city: 'Dhaka', timezone: 'Asia/Dhaka' },
    turf: { name: `Turf ${id}` },
    ...over,
  }) as BookingJson;

beforeEach(() => {
  setAccessToken(null);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T00:00:00.000Z'));
  return i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('my bookings', () => {
  it('splits upcoming and past by end time and status', async () => {
    mockApi([
      {
        path: '/me/bookings',
        body: {
          bookings: [
            booking('late', '2026-11-12', { status: 'pending' }),
            booking('soon', '2026-11-11', { status: 'confirmed' }),
            booking('cx', '2026-11-12', { status: 'cancelled' }),
            booking('old', '2026-11-09', { status: 'confirmed' }),
          ],
        },
      },
    ]);
    const { user } = renderApp('/me/bookings', { user: player });
    const panel = await screen.findByRole('tabpanel');
    const links = within(panel).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([expect.stringContaining('Arena soon'), expect.stringContaining('Arena late')]);
    expect(screen.queryByText(/Arena cx/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: en.myBookings.past }));
    const past = within(screen.getByRole('tabpanel')).getAllByRole('link');
    expect(past.map((l) => l.textContent)).toEqual([expect.stringContaining('Arena cx'), expect.stringContaining('Arena old')]);
    expect(past[0]).toHaveAttribute('href', '/me/bookings/cx');
  });

  it('rows show venue-zone time', async () => {
    mockApi([{ path: '/me/bookings', body: { bookings: [booking('a', '2026-11-12')] } }]);
    renderApp('/me/bookings', { user: player });
    expect(await screen.findByText('18:00 – 20:00')).toBeInTheDocument();
    expect(screen.getByText('Turf a', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(en.status.confirmed)).toBeInTheDocument();
  });

  it('empty upcoming links to search', async () => {
    mockApi([{ path: '/me/bookings', body: { bookings: [] } }]);
    renderApp('/me/bookings', { user: player });
    expect(await screen.findByText(en.myBookings.noUpcoming)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.myBookings.findVenues })).toHaveAttribute('href', '/');
  });

  it('load error shows retry', async () => {
    mockApi([{ path: '/me/bookings', status: 500, body: { error: { code: 'internal', message: 'x' } } }]);
    renderApp('/me/bookings', { user: player });
    expect(await screen.findByRole('button', { name: en.search.retry })).toBeInTheDocument();
  });
});
