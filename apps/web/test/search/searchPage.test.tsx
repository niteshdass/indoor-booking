import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { SearchResult } from '@booking/shared';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import { money } from '../../src/lib/format';
import { mockApi } from '../helpers/api';
import { renderApp } from '../helpers/render';

const venue: SearchResult = {
  slug: 'arena-one',
  name: 'Arena One',
  address: 'Road 1',
  city: 'Dhaka',
  country: 'BD',
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
  location: { lat: 1, lng: 2 },
  photo: null,
  sports: ['futsal'],
  distanceMeters: 1500,
  date: '2026-10-25',
  fromPrice: 1000,
  nextFreeSlot: {
    turfId: 't1',
    turfName: 'Court A',
    startAt: '2026-10-25T02:00:00.000Z',
    endAt: '2026-10-25T03:00:00.000Z',
    localStart: '08:00',
    localEnd: '09:00',
    price: 1000,
  },
};

beforeEach(() => i18n.changeLanguage('en'));
afterEach(() => vi.unstubAllGlobals());

describe('SearchPage', () => {
  it('renders results from URL criteria', async () => {
    const api = mockApi([{ path: '/search', body: { results: [venue], nextCursor: null } }]);
    renderApp('/?sport=futsal');
    expect(await screen.findByText('Arena One')).toBeInTheDocument();
    expect(api.calls[0]!.query.get('sport')).toBe('futsal');
    expect(screen.getByText((_, el) => el?.textContent === `from ${money(1000, 'BDT', 'en')}` && el.children.length === 0)).toBeInTheDocument();
    expect(screen.getByText(/08:00/)).toBeInTheDocument();
    expect(screen.getByText(/Court A/)).toBeInTheDocument();
  });

  it('submitting form updates URL and refetches', async () => {
    const api = mockApi([{ path: '/search', body: { results: [venue], nextCursor: null } }]);
    const { user, location } = renderApp('/');
    await screen.findByText('Arena One');
    await user.selectOptions(screen.getByLabelText(en.search.sport), 'tennis');
    await user.click(screen.getByRole('button', { name: en.search.submit }));
    await waitFor(() => expect(location().search).toContain('sport=tennis'));
    await waitFor(() => expect(api.calls.some((c) => c.query.get('sport') === 'tennis')).toBe(true));
  });

  it('empty state', async () => {
    mockApi([{ path: '/search', body: { results: [], nextCursor: null } }]);
    renderApp('/');
    expect(await screen.findByText(en.search.empty)).toBeInTheDocument();
  });

  it('result links to venue with date', async () => {
    mockApi([{ path: '/search', body: { results: [venue], nextCursor: null } }]);
    renderApp('/');
    const link = await screen.findByRole('link', { name: /Arena One/ });
    expect(link).toHaveAttribute('href', '/venues/arena-one?date=2026-10-25');
  });

  it('shows load more when a cursor remains, and an error alert with retry', async () => {
    mockApi([{ path: '/search', status: 429, body: { error: { code: 'rate_limited', message: 'x' } } }]);
    renderApp('/');
    expect(await screen.findByText(en.errors.rate_limited)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.search.retry })).toBeInTheDocument();
  });
});
