import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { apiPathFor, filtersToParams, readFilters, type BookingFilters } from '../../src/owner/bookings/bookingFilters';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, manualPayment, ownerBooking, ownerRoutes, staffUser, turf, venue } from './fixtures';

const NOW = '2026-10-26T04:30:00.000Z'; // 2026-10-26 in Dhaka

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

const base: BookingFilters = { venueId: 'v1', tab: 'all', sort: 'created-desc', turfId: null, from: null, to: null, status: null, q: '' };

function routes(bookings = [ownerBooking()]) {
  return [
    ...ownerRoutes(),
    { path: '/owners/o1/venues/v1/turfs', body: { turfs: [turf()] } },
    { path: '/owners/o1/bookings', body: { bookings, total: bookings.length } },
  ];
}

const listCalls = (api: ReturnType<typeof mockApi>) => api.calls.filter((c) => c.path === '/owners/o1/bookings');

describe('booking filters', () => {
  it('filters round-trip through the URL and omit defaults', () => {
    expect(filtersToParams(base).toString()).toBe('');
    // A tab's own default order is left out; another order is kept.
    expect(filtersToParams({ ...base, tab: 'past', sort: 'date-desc' }).toString()).toBe('tab=past');
    const f: BookingFilters = { venueId: 'v1', tab: 'upcoming', sort: 'ref-asc', turfId: 't1', from: '2026-10-20', to: '2026-10-25', status: 'confirmed', q: 'ada' };
    const p = filtersToParams(f);
    expect(Object.fromEntries(p)).toEqual({ tab: 'upcoming', sort: 'ref-asc', turf: 't1', from: '2026-10-20', to: '2026-10-25', status: 'confirmed', q: 'ada' });
    expect(readFilters(p, 'v1')).toEqual(f);
    expect(readFilters(new URLSearchParams(), 'v1')).toEqual(base);
    expect(readFilters(new URLSearchParams('tab=today'), 'v1')).toEqual({ ...base, tab: 'today', sort: 'date-asc' });
    expect(readFilters(new URLSearchParams('tab=bogus&sort=nope&status=bogus&from=nope'), 'v1')).toEqual(base);
    expect(readFilters(new URLSearchParams('from=2026-02-31&to=2026-13-01'), 'v1')).toEqual(base);
  });

  it('api path asks for one page of the tab in its order', () => {
    expect(apiPathFor('o1', base, 1)).toBe('/owners/o1/bookings?venueId=v1&scope=all&sort=created-desc&page=1&pageSize=25');
    const q = new URLSearchParams(apiPathFor('o1', { ...base, tab: 'past', sort: 'date-desc', q: ' ada ', status: 'pending', turfId: 't1', from: '2026-10-01' }, 3).split('?')[1]);
    expect(Object.fromEntries(q)).toEqual({
      venueId: 'v1',
      scope: 'past',
      sort: 'date-desc',
      page: '3',
      pageSize: '25',
      from: '2026-10-01',
      turfId: 't1',
      status: 'pending',
      q: 'ada',
    });
  });
});

describe('Bookings page', () => {
  it('an end date before the start shows an error and does not fetch', async () => {
    const api = mockApi(routes());
    renderApp(`/owner/${OWNER_ID}/bookings?from=2026-10-26&to=2026-10-01`, { user: staffUser });
    expect(await screen.findByText(en.owner.bookings.rangeOrder)).toBeTruthy();
    expect(listCalls(api)).toHaveLength(0);
  });

  it('opens on All, newest booked first, and rows link to booking detail', async () => {
    const api = mockApi(routes());
    renderApp(`/owner/${OWNER_ID}/bookings`, { user: staffUser });
    const link = await screen.findByRole('link', { name: 'BK-0001' });
    expect(link.getAttribute('href')).toBe(`/owner/${OWNER_ID}/bookings/b1`);
    expect(screen.getByText('Ada Player')).toBeTruthy();
    expect(within(screen.getByRole('table')).getByText(en.status.pending)).toBeTruthy();
    expect(screen.getByRole('tab', { name: en.owner.bookings.tab.all }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText(en.owner.bookings.sortLabel) as HTMLSelectElement).value).toBe('created-desc');
    const call = listCalls(api)[0]!;
    expect(call.query.get('venueId')).toBe('v1');
    expect(call.query.get('scope')).toBe('all');
    expect(call.query.get('sort')).toBe('created-desc');
    expect(call.query.has('from')).toBe(false);
    expect(screen.getByText(/^1 booking$/)).toBeTruthy();
  });

  it('a tab asks for its bookings in its own order; the sort select changes the order', async () => {
    const api = mockApi(routes());
    const { user, location } = renderApp(`/owner/${OWNER_ID}/bookings?page=2`, { user: staffUser });
    await screen.findByRole('link', { name: 'BK-0001' });
    await user.click(screen.getByRole('tab', { name: en.owner.bookings.tab.past }));
    await screen.findByRole('link', { name: 'BK-0001' });
    expect(location().search).toBe('?tab=past');
    let last = listCalls(api).at(-1)!;
    expect(last.query.get('scope')).toBe('past');
    expect(last.query.get('sort')).toBe('date-desc');
    expect(last.query.get('page')).toBe('1');

    await user.selectOptions(screen.getByLabelText(en.owner.bookings.sortLabel), 'ref-asc');
    await screen.findByRole('link', { name: 'BK-0001' });
    expect(new URLSearchParams(location().search).get('sort')).toBe('ref-asc');
    last = listCalls(api).at(-1)!;
    expect(last.query.get('sort')).toBe('ref-asc');

    // A new tab goes back to that tab's own order.
    await user.click(screen.getByRole('tab', { name: en.owner.bookings.tab.upcoming }));
    await screen.findByRole('link', { name: 'BK-0001' });
    expect(location().search).toBe('?tab=upcoming');
    expect(listCalls(api).at(-1)!.query.get('sort')).toBe('date-asc');
  });

  it('the Payment to check tab lists wallet payments to verify from any date, soonest first', async () => {
    const api = mockApi(routes([ownerBooking({ manualPayment: manualPayment() })]));
    const { user, location } = renderApp(`/owner/${OWNER_ID}/bookings`, { user: staffUser });
    await screen.findByRole('link', { name: 'BK-0001' });
    await user.click(screen.getByRole('tab', { name: en.status.paymentToCheck }));
    await screen.findByRole('link', { name: 'BK-0001' });
    expect(location().search).toBe('?tab=to_verify');
    const last = listCalls(api).at(-1)!;
    expect(last.query.get('scope')).toBe('to_verify');
    expect(last.query.get('sort')).toBe('date-asc');
    expect(screen.getByRole('tabpanel', { name: en.status.paymentToCheck })).toBeTruthy();
  });

  it('opens on the Payment to check tab from the URL', async () => {
    const api = mockApi(routes());
    renderApp(`/owner/${OWNER_ID}/bookings?tab=to_verify&venue=v1`, { user: staffUser });
    await screen.findByRole('link', { name: 'BK-0001' });
    expect(screen.getByRole('tab', { name: en.status.paymentToCheck }).getAttribute('aria-selected')).toBe('true');
    expect(listCalls(api)[0]!.query.get('scope')).toBe('to_verify');
  });

  it('a search waits for a pause, stays in the tab and says when nothing matches', async () => {
    const api = mockApi(routes([]));
    const { user } = renderApp(`/owner/${OWNER_ID}/bookings?tab=today`, { user: staffUser });
    await screen.findByText(en.owner.bookings.empty);
    await user.type(screen.getByLabelText(en.owner.bookings.search), 'zed');
    expect(await screen.findByText(en.owner.bookings.emptySearchHint)).toBeTruthy();
    const searches = listCalls(api).filter((c) => c.query.has('q'));
    expect(searches.map((c) => c.query.get('q'))).toEqual(['zed']);
    expect(searches[0]!.query.get('scope')).toBe('today');
  });

  it('pages on the server with the total, keeps the page in the URL and drops it on a new search', async () => {
    const all = Array.from({ length: 30 }, (_, i) => ownerBooking({ id: `b${i}`, reference: `BK-${100 + i}` }));
    const api = mockApi([
      ...ownerRoutes(),
      { path: '/owners/o1/venues/v1/turfs', body: { turfs: [turf()] } },
      {
        path: '/owners/o1/bookings',
        body: (call: { query: URLSearchParams }) => {
          const page = Number(call.query.get('page'));
          return { bookings: all.slice((page - 1) * 25, page * 25), total: all.length };
        },
      },
    ]);
    const { user, location } = renderApp(`/owner/${OWNER_ID}/bookings`, { user: staffUser });
    await screen.findByRole('link', { name: 'BK-100' });
    expect(screen.getByText('30 bookings')).toBeTruthy();
    expect(screen.getByText('1–25 of 30')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: en.pagination.next }));
    expect(await screen.findByRole('link', { name: 'BK-125' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'BK-100' })).toBeNull();
    expect(location().search).toContain('page=2');
    expect(listCalls(api).at(-1)!.query.get('page')).toBe('2');
    await user.type(screen.getByLabelText(en.owner.bookings.search), 'b');
    expect(location().search).not.toContain('page=');
  });

  it('a page past the end moves to the last page', async () => {
    const api = mockApi([
      ...ownerRoutes(),
      { path: '/owners/o1/venues/v1/turfs', body: { turfs: [turf()] } },
      {
        path: '/owners/o1/bookings',
        body: (call: { query: URLSearchParams }) => ({ bookings: call.query.get('page') === '1' ? [ownerBooking()] : [], total: 1 }),
      },
    ]);
    const { location } = renderApp(`/owner/${OWNER_ID}/bookings?page=4`, { user: staffUser });
    await screen.findByRole('link', { name: 'BK-0001' });
    expect(location().search).toBe('');
    expect(listCalls(api).map((c) => c.query.get('page'))).toEqual(['4', '1']);
  });

  it('a date range narrows the tab and shows beside the count', async () => {
    const api = mockApi(routes());
    renderApp(`/owner/${OWNER_ID}/bookings?from=2026-10-26&to=2026-11-01`, { user: staffUser });
    await screen.findByRole('link', { name: 'BK-0001' });
    expect(screen.getByText(/^1 booking · Mon, Oct 26 – Sun, Nov 1$/)).toBeTruthy();
    expect(listCalls(api)[0]!.query.get('from')).toBe('2026-10-26');
    expect(screen.getByRole('button', { name: /active/ })).toBeTruthy();
  });

  it('an empty result shows the empty notice', async () => {
    mockApi(routes([]));
    renderApp(`/owner/${OWNER_ID}/bookings`, { user: staffUser });
    expect(await screen.findByText(en.owner.bookings.empty)).toBeTruthy();
    expect(screen.getByText(en.owner.bookings.emptyHint)).toBeTruthy();
  });

  it('a foreign or garbage turf in the URL is not sent and the select shows all turfs', async () => {
    const api = mockApi(routes());
    renderApp(`/owner/${OWNER_ID}/bookings?turf=zzz`, { user: staffUser });
    await screen.findByRole('link', { name: 'BK-0001' });
    const calls = api.calls.filter((c) => c.path === '/owners/o1/bookings');
    expect(calls.every((c) => !c.query.has('turfId'))).toBe(true);
    expect((screen.getByLabelText(en.owner.bookings.turf) as HTMLSelectElement).value).toBe('');
  });

  it('a turf of the venue is sent and selected', async () => {
    const api = mockApi(routes());
    renderApp(`/owner/${OWNER_ID}/bookings?turf=t1`, { user: staffUser });
    await screen.findByRole('link', { name: 'BK-0001' });
    expect(api.calls.find((c) => c.path === '/owners/o1/bookings')!.query.get('turfId')).toBe('t1');
    expect((screen.getByLabelText(en.owner.bookings.turf) as HTMLSelectElement).value).toBe('t1');
  });

  it('changing venue clears the turf', async () => {
    mockApi([
      ...ownerRoutes({ venues: [venue(), venue({ id: 'v2', name: 'Arena Two' })] }),
      { path: '/owners/o1/venues/v1/turfs', body: { turfs: [turf()] } },
      { path: '/owners/o1/venues/v2/turfs', body: { turfs: [turf({ id: 't9', venueId: 'v2', name: 'Pitch Z' })] } },
      { path: '/owners/o1/bookings', body: { bookings: [] } },
    ]);
    const { user, location } = renderApp(`/owner/${OWNER_ID}/bookings?turf=t1`, { user: staffUser });
    await screen.findByText(en.owner.bookings.empty);
    await user.selectOptions(screen.getByLabelText(en.owner.venue), 'v2');
    const q = new URLSearchParams(location().search);
    expect(q.get('venue')).toBe('v2');
    expect(q.has('turf')).toBe(false);
  });
});
