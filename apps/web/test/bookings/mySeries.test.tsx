import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import { mockApi } from '../helpers/api';
import { renderApp } from '../helpers/render';
import { setAccessToken } from '../../src/lib/apiClient';
import type { BookingJson, PublicUser } from '../../src/lib/types';
import { seriesJson } from '../owner/fixtures';
import type { SeriesGameJson, SeriesJson } from '@booking/shared';

const player: PublicUser = { id: 'u1', name: 'Pat', email: 'p@x.com', emailVerified: true, phone: null, hasPassword: true, hasGoogle: false, platformAdmin: false };

type PlayerSeries = SeriesJson & { venue: { slug: string; name: string; timezone: string }; turf: { name: string } };

const game = (id: string, day: string, over: Partial<SeriesGameJson> = {}): SeriesGameJson => ({
  id,
  reference: `REF${id}`,
  businessDate: day,
  startAt: `${day}T04:00:00.000Z`,
  endAt: `${day}T05:00:00.000Z`,
  status: 'confirmed',
  total: 1000,
  amountPaid: 0,
  ...over,
});

const series = (over: Partial<PlayerSeries> = {}): PlayerSeries => ({
  ...seriesJson({ source: 'online', guest: null, ...over }),
  venue: { slug: 'arena-one', name: 'Arena One', timezone: 'Asia/Dhaka' },
  turf: { name: 'Court A' },
  ...over,
});

const booking = (id: string, day: string, over: Partial<BookingJson> = {}) =>
  ({
    id,
    reference: `REF${id}`,
    venueId: 'v1',
    turfId: 't1',
    businessDate: day,
    slots: [{ startAt: `${day}T04:00:00.000Z`, endAt: `${day}T05:00:00.000Z`, price: 1000 }],
    addons: [],
    currency: 'BDT',
    subtotal: 1000,
    addonsTotal: 0,
    total: 1000,
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
    groupId: null,
    venue: { slug: 'arena-one', name: 'Arena One', address: 'x', city: 'Dhaka', timezone: 'Asia/Dhaka' },
    turf: { name: 'Court A' },
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

const activeSeries = () =>
  series({
    id: 's1',
    status: 'active',
    pattern: { weekdays: ['thu'], startTime: '10:00', slotCount: 1, firstDate: '2026-11-12', endDate: null, count: 3 },
    games: [game('g1', '2026-11-12'), game('g2', '2026-11-19'), game('g3', '2026-11-26')],
    skipped: [{ date: '2026-12-03', reason: 'taken' }],
  });

describe('my series', () => {
  it('groups series games under their series and keeps single bookings separate', async () => {
    mockApi([
      {
        path: '/me/bookings',
        body: {
          bookings: [
            booking('g1', '2026-11-12', { seriesId: 's1' }),
            booking('g2', '2026-11-19', { seriesId: 's1' }),
            booking('solo', '2026-11-13'),
          ],
        },
      },
      { path: '/me/series', body: { series: [activeSeries()] } },
    ]);
    renderApp('/me/bookings', { user: player });
    const card = await screen.findByRole('region', { name: /Arena One/ });
    expect(within(card).getByText(en.series.status.active)).toBeInTheDocument();
    expect(within(card).getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Court A · Thu · 10:00 – 11:00')).toBeInTheDocument();
    expect(within(card).getByText(/Next games/)).toBeInTheDocument();
    expect(within(card).getByText(/Skipped date/)).toBeInTheDocument();

    const panel = screen.getByRole('tabpanel');
    expect(await within(panel).findAllByRole('link')).toHaveLength(1);
    expect(within(panel).getByRole('link')).toHaveAttribute('href', '/me/bookings/solo');
  });

  it('withdraw posts and refreshes', async () => {
    let withdrawn = false;
    const api = mockApi([
      { path: '/me/bookings', body: { bookings: [] } },
      {
        path: '/me/series',
        body: () => ({
          series: [
            series({
              id: 's1',
              status: withdrawn ? 'withdrawn' : 'requested',
              respondBy: '2026-11-10T10:30:00.000Z',
              games: [game('g1', '2026-11-12', { status: withdrawn ? 'rejected' : 'pending' })],
            }),
          ],
        }),
      },
      {
        method: 'POST',
        path: '/me/series/s1/withdraw',
        body: () => {
          withdrawn = true;
          return { series: series({ id: 's1', status: 'withdrawn' }) };
        },
      },
    ]);
    const { user } = renderApp('/me/bookings', { user: player });
    expect(await screen.findByText(/The venue will answer by/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.series.player.withdraw }));
    expect(await screen.findByText(en.series.status.withdrawn)).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === '/me/series' && c.method === 'GET')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: en.series.player.withdraw })).not.toBeInTheDocument();
  });

  it('cancel all future shows kept dates', async () => {
    const api = mockApi([
      { path: '/me/bookings', body: { bookings: [] } },
      { path: '/me/series', body: { series: [activeSeries()] } },
      {
        method: 'POST',
        path: '/me/series/s1/cancel-future',
        body: { series: activeSeries(), cancelled: ['g1', 'g3'], kept: [{ id: 'g2', code: 'too_late' }] },
      },
    ]);
    const { user } = renderApp('/me/bookings', { user: player });
    await user.click(await screen.findByRole('button', { name: en.series.player.cancelFuture }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: en.series.player.cancelFutureConfirm }));
    expect(await screen.findByText(/Could not cancel: .*Thu, Nov 19/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.path === '/me/series/s1/cancel-future' && c.method === 'POST')).toBe(true);
    await waitFor(() => expect(api.calls.filter((c) => c.path === '/me/series' && c.method === 'GET')).toHaveLength(2));
  });

  it('declined series shows its status', async () => {
    mockApi([
      { path: '/me/bookings', body: { bookings: [] } },
      { path: '/me/series', body: { series: [series({ id: 's2', status: 'declined', declineReason: 'Booked for a tournament', games: [] })] } },
    ]);
    renderApp('/me/bookings', { user: player });
    const card = await screen.findByRole('region', { name: /Arena One/ });
    expect(within(card).getByText(en.series.status.declined)).toBeInTheDocument();
    expect(within(card).getByText(/Booked for a tournament/)).toBeInTheDocument();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps past and cancelled games of a listed series in the single list', async () => {
    mockApi([
      {
        path: '/me/bookings',
        body: {
          bookings: [
            booking('next', '2026-11-12', { seriesId: 's1' }),
            booking('done', '2026-11-05', { seriesId: 's1', status: 'completed' }),
            booking('cx', '2026-11-19', { seriesId: 's1', status: 'cancelled' }),
          ],
        },
      },
      {
        path: '/me/series',
        body: {
          series: [
            series({
              id: 's1',
              status: 'active',
              games: [
                game('done', '2026-11-05', { status: 'completed' }),
                game('next', '2026-11-12'),
                game('cx', '2026-11-19', { status: 'cancelled' }),
              ],
            }),
          ],
        },
      },
    ]);
    const { user } = renderApp('/me/bookings', { user: player });
    await screen.findByRole('region', { name: /Arena One/ });
    expect(within(screen.getByRole('tabpanel')).getByText(en.myBookings.noUpcoming)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: en.myBookings.past }));
    const links = within(screen.getByRole('tabpanel')).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href')).sort()).toEqual(['/me/bookings/cx', '/me/bookings/done']);
    expect(within(screen.getByRole('tabpanel')).getAllByText(en.series.badge)).toHaveLength(2);
  });

  it('shows the load error when the reload after a withdraw fails', async () => {
    let withdrawn = false;
    mockApi([
      { path: '/me/bookings', body: () => (withdrawn ? { status: 500, body: { error: { code: 'internal', message: 'x' } } } : { bookings: [] }) },
      {
        path: '/me/series',
        body: { series: [series({ id: 's1', status: 'requested', respondBy: '2026-11-10T10:30:00.000Z', games: [game('g1', '2026-11-12', { status: 'pending' })] })] },
      },
      {
        method: 'POST',
        path: '/me/series/s1/withdraw',
        body: () => {
          withdrawn = true;
          return { series: series({ id: 's1', status: 'withdrawn' }) };
        },
      },
    ]);
    const { user } = renderApp('/me/bookings', { user: player });
    await user.click(await screen.findByRole('button', { name: en.series.player.withdraw }));
    expect(await screen.findByText(en.errors.generic)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.series.player.withdraw })).not.toBeInTheDocument();
  });
});
