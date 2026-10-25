import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { apiPathFor, filtersToParams, matchesQuery, readFilters, type BookingFilters } from '../../src/owner/bookings/bookingFilters';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, ownerBooking, ownerRoutes, staffUser, turf, venue } from './fixtures';

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

const v = venue();
const base: BookingFilters = { venueId: 'v1', turfId: null, from: '2026-10-26', to: '2026-10-26', status: null, q: '' };

function routes(bookings = [ownerBooking()]) {
  return [
    ...ownerRoutes(),
    { path: '/owners/o1/venues/v1/turfs', body: { turfs: [turf()] } },
    { path: '/owners/o1/bookings', body: { bookings } },
  ];
}

describe('booking filters', () => {
  it('filters round-trip through the URL and omit defaults', () => {
    expect(filtersToParams(base, '2026-10-26').toString()).toBe('');
    const f: BookingFilters = { venueId: 'v1', turfId: 't1', from: '2026-10-20', to: '2026-10-25', status: 'confirmed', q: 'ada' };
    const p = filtersToParams(f, '2026-10-26');
    expect(Object.fromEntries(p)).toEqual({ turf: 't1', from: '2026-10-20', to: '2026-10-25', status: 'confirmed', q: 'ada' });
    expect(readFilters(p, v)).toEqual(f);
    expect(readFilters(new URLSearchParams(), v)).toEqual(base);
    expect(readFilters(new URLSearchParams('status=bogus&from=nope'), v)).toEqual(base);
  });

  it('api path never includes q and includes status only when set', () => {
    expect(apiPathFor('o1', { ...base, q: 'ada' })).toBe('/owners/o1/bookings?venueId=v1&from=2026-10-26&to=2026-10-26');
    const path = apiPathFor('o1', { ...base, status: 'pending', turfId: 't1' });
    const q = new URLSearchParams(path.split('?')[1]);
    expect(q.get('status')).toBe('pending');
    expect(q.get('turfId')).toBe('t1');
    expect(q.has('q')).toBe(false);
  });

  it('search matches reference, name and phone digits', () => {
    const b = ownerBooking();
    expect(matchesQuery(b, 'bk-0001')).toBe(true);
    expect(matchesQuery(b, 'ADA')).toBe(true);
    expect(matchesQuery(b, '+880 1712')).toBe(true);
    expect(matchesQuery(b, '99999')).toBe(false);
    expect(matchesQuery(b, 'zed')).toBe(false);
    expect(matchesQuery(b, '')).toBe(true);
    expect(matchesQuery(ownerBooking({ customer: null }), 'ada')).toBe(false);
  });
});

describe('Bookings page', () => {
  it('a range over 31 days shows an error and does not fetch', async () => {
    const api = mockApi(routes());
    renderApp(`/owner/${OWNER_ID}/bookings?from=2026-09-01&to=2026-10-26`, { user: staffUser });
    expect(await screen.findByText(en.owner.bookings.rangeMax)).toBeTruthy();
    expect(api.calls.some((c) => c.path === '/owners/o1/bookings')).toBe(false);
  });

  it('rows link to booking detail', async () => {
    const api = mockApi(routes());
    renderApp(`/owner/${OWNER_ID}/bookings`, { user: staffUser });
    const link = await screen.findByRole('link', { name: 'BK-0001' });
    expect(link.getAttribute('href')).toBe(`/owner/${OWNER_ID}/bookings/b1`);
    expect(screen.getByText('Ada Player')).toBeTruthy();
    expect(within(screen.getByRole('table')).getByText(en.status.pending)).toBeTruthy();
    const call = api.calls.find((c) => c.path === '/owners/o1/bookings')!;
    expect(call.query.get('venueId')).toBe('v1');
    expect(call.query.get('from')).toBe('2026-10-26');
  });

  it('typing a search filters rows client-side without refetching', async () => {
    const api = mockApi(routes([ownerBooking(), ownerBooking({ id: 'b2', reference: 'BK-0002', customer: { name: 'Bob', phone: null, email: null } })]));
    const { user } = renderApp(`/owner/${OWNER_ID}/bookings`, { user: staffUser });
    await screen.findByRole('link', { name: 'BK-0002' });
    await user.type(screen.getByLabelText(en.owner.bookings.search), 'bob');
    expect(screen.queryByRole('link', { name: 'BK-0001' })).toBeNull();
    expect(screen.getByRole('link', { name: 'BK-0002' })).toBeTruthy();
    expect(api.calls.filter((c) => c.path === '/owners/o1/bookings')).toHaveLength(1);
  });

  it('an empty result shows the empty notice', async () => {
    mockApi(routes([]));
    renderApp(`/owner/${OWNER_ID}/bookings`, { user: staffUser });
    expect(await screen.findByText(en.owner.bookings.empty)).toBeTruthy();
  });

  it('500 results show the capped notice', async () => {
    const many = Array.from({ length: 500 }, (_, i) => ownerBooking({ id: `b${i}`, reference: `BK-${i}` }));
    mockApi(routes(many));
    renderApp(`/owner/${OWNER_ID}/bookings`, { user: staffUser });
    expect(await screen.findByText(en.owner.bookings.capped)).toBeTruthy();
  });

  it('fewer than 500 results show no capped notice', async () => {
    mockApi(routes());
    renderApp(`/owner/${OWNER_ID}/bookings`, { user: staffUser });
    await screen.findByRole('link', { name: 'BK-0001' });
    expect(screen.queryByText(en.owner.bookings.capped)).toBeNull();
  });
});
