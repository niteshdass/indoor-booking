import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { summarize } from '../../src/owner/today/summarize';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, ownerBooking, ownerReview, ownerRoutes, seriesJson, slotDay, staffUser, turf } from './fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-26T03:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const slot = (startAt: string, endAt: string) => ({ startAt, endAt, price: 1000 });

describe('summarize', () => {
  it('summarize counts live bookings, nets refunds into collected and counts pending', () => {
    const s = summarize([
      ownerBooking({ id: 'a', status: 'confirmed', amountPaid: 3000 }),
      ownerBooking({ id: 'b', status: 'cancelled', amountPaid: 2000, amountRefunded: 2000 }),
      ownerBooking({ id: 'c', status: 'pending' }),
      ownerBooking({ id: 'd', status: 'expired' }),
    ]);
    expect(s.count).toBe(2);
    expect(s.collected).toBe(3000);
    expect(s.pending).toBe(1);
  });

  it('summarize upcoming excludes finished and terminal bookings', () => {
    const later = [slot('2026-10-26T08:00:00.000Z', '2026-10-26T09:00:00.000Z')];
    const soon = [slot('2026-10-26T04:00:00.000Z', '2026-10-26T05:00:00.000Z')];
    const past = [slot('2026-10-26T01:00:00.000Z', '2026-10-26T02:00:00.000Z')];
    const s = summarize([
      ownerBooking({ id: 'later', status: 'confirmed', slots: later }),
      ownerBooking({ id: 'soon', status: 'pending', slots: soon }),
      ownerBooking({ id: 'past', status: 'confirmed', slots: past }),
      ownerBooking({ id: 'done', status: 'completed', slots: soon }),
      ownerBooking({ id: 'gone', status: 'cancelled', slots: soon }),
    ]);
    expect(s.upcoming.map((b) => b.id)).toEqual(['soon', 'later']);
  });

  it('summarize compares instants, not strings, for offset and no-millisecond end times', () => {
    // 07:30+05:00 is 02:30Z, before now (03:00Z); as a string it sorts after '2026-10-26T03:00:00.000Z'.
    const endedOffset = [slot('2026-10-26T06:00:00+05:00', '2026-10-26T07:30:00+05:00')];
    // 03:30Z without milliseconds is still ahead of now.
    const aheadNoMs = [slot('2026-10-26T03:00:00Z', '2026-10-26T03:30:00Z')];
    const s = summarize([
      ownerBooking({ id: 'ended', status: 'confirmed', slots: endedOffset }),
      ownerBooking({ id: 'ahead', status: 'confirmed', slots: aheadNoMs }),
    ]);
    expect(s.upcoming.map((b) => b.id)).toEqual(['ahead']);
  });
});

describe('Today page', () => {
  it('Today shows stat cards in venue currency for the selected venue', async () => {
    const api = mockApi([
      ...ownerRoutes(),
      {
        path: '/owners/o1/bookings',
        body: {
          bookings: [
            ownerBooking({ id: 'a', status: 'confirmed', amountPaid: 3000, paymentStatus: 'paid' }),
            ownerBooking({ id: 'b', status: 'pending', customer: { name: 'Bob Pending', phone: null, email: null } }),
          ],
        },
      },
    ]);
    renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    const collected = (await screen.findByText(en.owner.today.collected)).closest('div')!;
    expect(collected.textContent).toMatch(/BDT\s30\.00/);
    expect(api.calls.find((c) => c.path === '/owners/o1/bookings')!.query.get('venueId')).toBe('v1');
    const pending = screen.getByText(en.owner.today.pending).closest('div')!;
    expect(within(pending).getByText('1')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Bob Pending/ });
    expect(link.getAttribute('href')).toBe(`/owner/${OWNER_ID}/bookings/b`);
  });

  it('Today with no venues prompts to create one', async () => {
    mockApi(ownerRoutes({ venues: [], permissions: ['booking.view', 'venue.manage'] }));
    renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    expect(await screen.findByText(en.owner.today.noVenues)).toBeTruthy();
    const link = screen.getByRole('link', { name: en.owner.today.createVenue });
    expect(link.getAttribute('href')).toBe(`/owner/${OWNER_ID}/venues/new`);
  });

  it('Today links to the Overview trends only with reports.view', async () => {
    mockApi([...ownerRoutes({ permissions: ['booking.view', 'reports.view'] }), { path: `/owners/${OWNER_ID}/bookings`, body: { bookings: [] } }]);
    renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    const link = await screen.findByRole('link', { name: new RegExp(en.owner.today.trends) });
    expect(link.getAttribute('href')).toBe(`/owner/${OWNER_ID}/overview?venue=v1`);
  });

  it('Today hides the trends link without reports.view', async () => {
    mockApi([...ownerRoutes(), { path: `/owners/${OWNER_ID}/bookings`, body: { bookings: [] } }]);
    renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    await screen.findByText(en.owner.today.none);
    expect(screen.queryByRole('link', { name: new RegExp(en.owner.today.trends) })).toBeNull();
  });

  const pendingRoutes = (perms: Parameters<typeof ownerRoutes>[0] = {}) => [
    ...ownerRoutes(perms),
    {
      method: 'GET',
      path: '/owners/o1/bookings',
      body: (_c: unknown, n: number) => ({
        bookings: [
          ownerBooking({
            id: 'b',
            status: n === 0 ? 'pending' : 'confirmed',
            slots: [slot('2026-10-26T08:00:00.000Z', '2026-10-26T09:00:00.000Z')],
            customer: { name: 'Bob Pending', phone: null, email: null },
          }),
        ],
      }),
    },
  ];

  it('Today confirms a pending row and reloads', async () => {
    const api = mockApi([
      ...pendingRoutes({ permissions: ['booking.view', 'booking.confirm'] }),
      { method: 'POST', path: '/owners/o1/bookings/b/confirm', body: { booking: ownerBooking({ id: 'b', status: 'confirmed' }) } },
    ]);
    const { user } = renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.owner.bookings.actions.confirm }));
    await waitFor(() => expect(screen.queryByRole('button', { name: en.owner.bookings.actions.confirm })).toBeNull());
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Bob Pending/ })).toBeTruthy();
  });

  it('Today rejects a pending row with a reason', async () => {
    const api = mockApi([
      ...pendingRoutes({ permissions: ['booking.view', 'booking.confirm'] }),
      { method: 'POST', path: '/owners/o1/bookings/b/reject', body: { booking: ownerBooking({ id: 'b', status: 'rejected' }) } },
    ]);
    const { user } = renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.owner.bookings.actions.reject }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'closed');
    await user.click(within(dialog).getByRole('button', { name: en.owner.bookings.reject.confirm }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith('/reject'))).toBe(true));
    expect(api.calls.find((c) => c.path.endsWith('/reject'))!.body).toEqual({ reason: 'closed' });
  });

  it('Today hides confirm and reject without booking.confirm', async () => {
    mockApi(pendingRoutes());
    renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    await screen.findByRole('link', { name: /Bob Pending/ });
    expect(screen.queryByRole('button', { name: en.owner.bookings.actions.confirm })).toBeNull();
    expect(screen.queryByRole('button', { name: en.owner.bookings.actions.reject })).toBeNull();
  });

  it('Today reloads the list when a confirm hits a 409', async () => {
    const api = mockApi([
      ...pendingRoutes({ permissions: ['booking.view', 'booking.confirm'] }),
      { method: 'POST', path: '/owners/o1/bookings/b/confirm', status: 409, body: { error: { code: 'invalid_transition', message: 'x' } } },
    ]);
    const { user } = renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.owner.bookings.actions.confirm }));
    // Today's list (no date range) loads again; the same-day-last-week call carries from/to.
    const todayLoads = () => api.calls.filter((c) => c.method === 'GET' && c.path === '/owners/o1/bookings' && !c.query.has('from'));
    await waitFor(() => expect(todayLoads()).toHaveLength(2));
  });

  it('Today adds last week, court usage and the things that need attention', async () => {
    mockApi([
      ...ownerRoutes({ permissions: ['booking.view', 'review.manage'] }),
      {
        path: '/owners/o1/bookings',
        body: (c: { query: URLSearchParams }) =>
          c.query.has('from')
            ? { bookings: [ownerBooking({ id: 'x', status: 'confirmed' }), ownerBooking({ id: 'y', status: 'confirmed' })] }
            : {
                bookings: [
                  ownerBooking({ id: 'a', status: 'pending' }),
                  ownerBooking({
                    id: 'h',
                    status: 'awaiting_payment',
                    holdExpiresAt: '2026-10-26T03:20:00.000Z',
                    customer: { name: 'Hana Hold', phone: null, email: null },
                  }),
                ],
              },
      },
      { path: '/owners/o1/venues/v1/turfs', body: { turfs: [turf()] } },
      { path: '/owners/o1/venues/v1/turfs/t1/slots', body: { day: slotDay() } },
      {
        path: '/owners/o1/series',
        body: { series: [seriesJson({ id: 's9', status: 'requested', guest: { name: 'Rafi Request', phone: '+8801700000000' } })], nextBefore: null },
      },
      { path: '/owners/o1/reviews', body: { reviews: [ownerReview({ id: 'r2', stars: 1, comment: 'Lights broken' }), ownerReview()] } },
    ]);
    renderApp(`/owner/${OWNER_ID}`, { user: staffUser });

    expect(await screen.findByText('Same day last week: 2')).toBeTruthy();
    const used = (await screen.findByText(en.owner.today.courtsUsed)).closest('div')!;
    expect(used.textContent).toContain('100%'); // two 1h bookings on the one open hour, capped at open
    const attention = await screen.findByRole('region', { name: en.owner.today.attention });
    const links = within(attention).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      `/owner/${OWNER_ID}/series/s9`,
      `/owner/${OWNER_ID}/bookings/h`,
      `/owner/${OWNER_ID}/reviews?venue=v1&stars=1`,
    ]);
    expect(within(attention).getByText('Rafi Request asked for a weekly booking')).toBeTruthy();
    expect(within(attention).getByText('Lights broken')).toBeTruthy();
  });

  // Only today's list (no date range); the same-day-last-week call carries from/to.
  const todayList = (body: (n: number) => unknown) => ({
    path: '/owners/o1/bookings',
    body: (c: { query: URLSearchParams }, n: number) => (c.query.has('from') ? { bookings: [] } : body(n)),
  });
  const named = (id: string, name: string) => ownerBooking({ id, status: 'confirmed', customer: { name, phone: null, email: null } });

  it('Today refetches silently and shows the update time', async () => {
    let loads = 0;
    mockApi([
      ...ownerRoutes(),
      todayList(() => (loads++ === 0 ? { bookings: [named('a', 'Ann First')] } : { bookings: [named('a', 'Ann First'), named('b', 'Ben Second')] })),
    ]);
    renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    await screen.findByRole('link', { name: /Ann First/ });
    expect(screen.getByText(/^Updated \d{2}:\d{2}$/)).toBeTruthy();
    window.dispatchEvent(new Event('online'));
    expect(screen.queryByLabelText(en.common.loading)).toBeNull();
    expect(await screen.findByRole('link', { name: /Ben Second/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ann First/ })).toBeTruthy();
  });

  it('Today keeps its data and offers retry when a refresh fails', async () => {
    let loads = 0;
    mockApi([...ownerRoutes(), todayList(() => (loads++ === 1 ? { status: 500, body: {} } : { bookings: [named('a', 'Ann First')] }))]);
    const { user } = renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    await screen.findByRole('link', { name: /Ann First/ });
    window.dispatchEvent(new Event('online'));
    expect(await screen.findByText(en.owner.today.refreshFailed)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ann First/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: en.auth.retry }));
    await waitFor(() => expect(screen.queryByText(en.owner.today.refreshFailed)).toBeNull());
    expect(screen.getByText(/^Updated \d{2}:\d{2}$/)).toBeTruthy();
  });

  it('Today leaves the extras out when they fail to load', async () => {
    mockApi([...ownerRoutes(), { path: '/owners/o1/bookings', body: (c: { query: URLSearchParams }) => (c.query.has('from') ? { status: 500, body: {} } : { bookings: [] }) }]);
    renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    await screen.findByText(en.owner.today.collected);
    expect(screen.queryByText(en.owner.today.courtsUsed)).toBeNull();
    expect(screen.queryByRole('region', { name: en.owner.today.attention })).toBeNull();
    expect(screen.queryByText(/Same day last week/)).toBeNull();
  });
});
