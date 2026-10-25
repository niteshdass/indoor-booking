import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import type { Permission } from '../../src/owner/types';
import { renderApp } from '../helpers/render';
import { mockApi, type Call, type Route } from '../helpers/api';
import { OWNER_ID, ownerBooking, ownerRoutes, seriesJson, staffUser, turf } from './fixtures';

const NOW = '2026-10-26T04:30:00.000Z';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const game = (n: number, over: Partial<ReturnType<typeof seriesJson>['games'][number]> = {}) => ({
  id: `g${n}`,
  reference: `BK-00${String(n).padStart(2, '0')}`,
  businessDate: `2026-11-${String(n).padStart(2, '0')}`,
  startAt: `2026-11-${String(n).padStart(2, '0')}T04:00:00.000Z`,
  endAt: `2026-11-${String(n).padStart(2, '0')}T05:00:00.000Z`,
  status: 'confirmed' as const,
  total: 1000,
  amountPaid: 0,
  ...over,
});

const requested = (over = {}) =>
  seriesJson({
    id: 's1',
    status: 'requested',
    source: 'online',
    player: { id: 'u1', name: 'Pia Player' },
    guest: null,
    respondBy: '2026-10-27T04:30:00.000Z',
    games: [game(2, { status: 'pending' }), game(9, { status: 'pending' })],
    ...over,
  });

function routes(perms: Permission[], extra: Route[] = []): Route[] {
  return [
    ...ownerRoutes({ permissions: perms }),
    { path: '/owners/o1/venues/v1/turfs', body: { turfs: [turf()] } },
    ...extra,
  ];
}

describe('Owner series list', () => {
  it('list filters by status in the URL and pages with nextBefore', async () => {
    const api = mockApi(
      routes(['booking.view'], [
        {
          path: '/owners/o1/series',
          body: (call: Call) =>
            call.query.get('before')
              ? { series: [seriesJson({ id: 's2', guest: { name: 'Second Group', phone: '+8801' } })], nextBefore: null }
              : { series: [requested()], nextBefore: '2026-10-20T00:00:00.000Z' },
        },
      ]),
    );
    const { user, location } = renderApp(`/owner/${OWNER_ID}/series?venue=v1`, { user: staffUser });
    expect(await screen.findByText('Pia Player')).toBeTruthy();
    expect(screen.getByText(/Answer by/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.series.owner.newSeries })).toBeNull();

    await user.click(screen.getByRole('button', { name: en.series.owner.showMore }));
    expect(await screen.findByText('Second Group')).toBeTruthy();
    expect(screen.getByText('Pia Player')).toBeTruthy();
    expect(api.calls.filter((c) => c.path === '/owners/o1/series').at(-1)!.query.get('before')).toBe('2026-10-20T00:00:00.000Z');
    expect(screen.queryByRole('button', { name: en.series.owner.showMore })).toBeNull();

    await user.selectOptions(screen.getByLabelText(en.owner.bookings.status), 'requested');
    await waitFor(() => expect(location().search).toContain('status=requested'));
    await waitFor(() => {
      const last = api.calls.filter((c) => c.path === '/owners/o1/series').at(-1)!;
      expect(last.query.get('status')).toBe('requested');
      expect(last.query.get('venueId')).toBe('v1');
      expect(last.query.has('before')).toBe(false);
    });
  });

  it('shows New series only with booking.create', async () => {
    mockApi(routes(['booking.view', 'booking.create'], [{ path: '/owners/o1/series', body: { series: [], nextBefore: null } }]));
    renderApp(`/owner/${OWNER_ID}/series`, { user: staffUser });
    expect(await screen.findByRole('button', { name: en.series.owner.newSeries })).toBeTruthy();
    expect(await screen.findByText(en.series.owner.empty)).toBeTruthy();
  });
});

describe('Owner series detail', () => {
  const URL_ = `/owner/${OWNER_ID}/series/s1`;
  const GET = { path: '/owners/o1/series/s1' };

  it('requested series: accept posts and refreshes', async () => {
    let answered = false;
    const api = mockApi(
      routes(['booking.view', 'booking.confirm'], [
        { ...GET, body: () => ({ series: answered ? requested({ status: 'active' }) : requested() }) },
        { method: 'POST', path: '/owners/o1/series/s1/accept', body: () => ((answered = true), { series: requested({ status: 'active' }) }) },
      ]),
    );
    const { user } = renderApp(URL_, { user: staffUser });
    expect(await screen.findByText(/Answer by/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.series.owner.cancelGame })).toBeNull();
    await user.click(screen.getByRole('button', { name: en.series.owner.accept }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith('/accept'))).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: en.series.owner.accept })).toBeNull());
    expect(screen.queryByText(/Answer by/)).toBeNull();
  });

  it('requested series: decline sends the reason', async () => {
    const api = mockApi(
      routes(['booking.view', 'booking.confirm'], [
        { ...GET, body: { series: requested() } },
        { method: 'POST', path: '/owners/o1/series/s1/decline', body: { series: requested({ status: 'declined', declineReason: 'Booked out' }) } },
      ]),
    );
    const { user } = renderApp(URL_, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.series.owner.decline }));
    await user.type(screen.getByLabelText(en.owner.bookings.reason.label), 'Booked out');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.series.owner.decline }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith('/decline'))).toBe(true));
    expect(api.calls.find((c) => c.path.endsWith('/decline'))!.body).toEqual({ reason: 'Booked out' });
    expect(await screen.findByText(en.series.status.declined)).toBeTruthy();
  });

  it('a series_not_requested conflict shows the error and refreshes', async () => {
    const api = mockApi(
      routes(['booking.view', 'booking.confirm'], [
        { ...GET, body: { series: requested() } },
        { method: 'POST', path: '/owners/o1/series/s1/accept', status: 409, body: { error: { code: 'series_not_requested', message: 'x' } } },
      ]),
    );
    const { user } = renderApp(URL_, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.series.owner.accept }));
    expect(await screen.findByText(en.errors.series_not_requested)).toBeTruthy();
    await waitFor(() => expect(api.calls.filter((c) => c.method === 'GET' && c.path === '/owners/o1/series/s1').length).toBe(2));
  });

  it('no accept or decline without booking.confirm', async () => {
    mockApi(routes(['booking.view'], [{ ...GET, body: { series: requested() } }]));
    renderApp(URL_, { user: staffUser });
    expect(await screen.findByText('Pia Player')).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.series.owner.accept })).toBeNull();
    expect(screen.queryByRole('button', { name: en.series.owner.decline })).toBeNull();
  });

  it('cancel all future posts and shows kept dates', async () => {
    const active = seriesJson({
      id: 's1',
      games: [game(2), game(9), game(16, { status: 'completed' })],
      skipped: [{ date: '2026-11-23', reason: 'closed' }],
    });
    const api = mockApi(
      routes(['booking.view', 'booking.cancel'], [
        { ...GET, body: { series: active } },
        {
          method: 'POST',
          path: '/owners/o1/series/s1/cancel-future',
          body: { series: active, cancelled: ['g2'], kept: [{ id: 'g9', code: 'too_late' }] },
        },
      ]),
    );
    const { user } = renderApp(URL_, { user: staffUser });
    expect(await screen.findByText(en.series.owner.skippedTitle)).toBeTruthy();
    expect(screen.getByText(en.series.reason.closed, { exact: false })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: en.series.owner.cancelFuture }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/2 games/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: en.series.owner.cancelFutureConfirm }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith('/cancel-future'))).toBe(true));
    expect(await screen.findByText(/Could not cancel:/)).toBeTruthy();
    expect(screen.getByText(/Could not cancel:.*Mon, Nov 9/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: en.series.owner.cancelGame }).length).toBe(2);
  });

  it('renders in Russian', async () => {
    await i18n.changeLanguage('ru');
    mockApi(routes(['booking.view', 'booking.confirm'], [{ ...GET, body: { series: requested() } }]));
    renderApp(URL_, { user: staffUser });
    expect(await screen.findByRole('button', { name: ru.series.owner.accept })).toBeTruthy();
    expect(screen.getByRole('button', { name: ru.series.owner.decline })).toBeTruthy();
    expect(screen.getByText(ru.series.status.requested)).toBeTruthy();
  });
});

describe('Series badge', () => {
  it('bookings list row shows the Series badge linking to the series', async () => {
    mockApi(
      routes(['booking.view'], [
        { path: '/owners/o1/bookings', body: { bookings: [ownerBooking({ seriesId: 's1' })] } },
      ]),
    );
    renderApp(`/owner/${OWNER_ID}/bookings?venue=v1`, { user: staffUser });
    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: en.series.badge });
      expect(links.map((a) => a.getAttribute('href'))).toContain(`/owner/${OWNER_ID}/series/s1`);
    });
  });

  it('booking detail shows the badge too', async () => {
    mockApi(
      routes(['booking.view'], [
        { path: '/owners/o1/bookings/b1', body: { booking: ownerBooking({ seriesId: 's1' }), payments: [], refunds: [] } },
      ]),
    );
    renderApp(`/owner/${OWNER_ID}/bookings/b1`, { user: staffUser });
    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: en.series.badge });
      expect(links.map((a) => a.getAttribute('href'))).toContain(`/owner/${OWNER_ID}/series/s1`);
    });
  });
});
