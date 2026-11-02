import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import { mockApi } from '../helpers/api';
import { setAccessToken } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import type { PublicUser, PublicVenue, SavedVenueJson } from '../../src/lib/types';

const player: PublicUser = { id: 'u1', name: 'Pat', email: 'p@x.com', emailVerified: true, phone: null, hasPassword: true, hasGoogle: false, platformAdmin: false };

const venue: PublicVenue = {
  slug: 'arena-one',
  name: 'Arena One',
  address: 'Road 1',
  city: 'Dhaka',
  country: 'BD',
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
  location: { lat: 1, lng: 2 },
  photos: [],
  amenities: [],
  rating: null,
  turfs: [],
};

const saved = (slug: string, over: Partial<SavedVenueJson> = {}): SavedVenueJson => ({
  slug,
  name: `Venue ${slug}`,
  address: 'Road 1',
  city: 'Dhaka',
  photo: null,
  sports: ['futsal'],
  rating: null,
  savedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  setAccessToken(null);
  return i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('save on the venue page', () => {
  it('signed out, Save leads to sign-in and back', async () => {
    const m = mockApi([{ path: '/venues/arena-one', body: { venue } }]);
    renderApp('/venues/arena-one?date=2026-11-03');
    expect(await screen.findByRole('link', { name: en.savedVenues.save })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent('/venues/arena-one?date=2026-11-03')}`,
    );
    expect(m.calls.some((c) => c.path.startsWith('/me/saved-venues'))).toBe(false);
  });

  it('signed in, saves and unsaves at once', async () => {
    const m = mockApi([
      { path: '/venues/arena-one', body: { venue } },
      { method: 'GET', path: '/me/saved-venues/arena-one', body: { saved: false } },
      { method: 'PUT', path: '/me/saved-venues/arena-one', body: { saved: true } },
      { method: 'DELETE', path: '/me/saved-venues/arena-one', status: 204 },
    ]);
    const { user } = renderApp('/venues/arena-one', { user: player });
    const button = await screen.findByRole('button', { name: en.savedVenues.save });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(button).toHaveAccessibleName(en.savedVenues.saved);
    await waitFor(() => expect(m.calls.some((c) => c.method === 'PUT')).toBe(true));
    await user.click(button);
    expect(button).toHaveAccessibleName(en.savedVenues.save);
    await waitFor(() => expect(m.calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('a full list puts the button back and says why', async () => {
    mockApi([
      { path: '/venues/arena-one', body: { venue } },
      { method: 'GET', path: '/me/saved-venues/arena-one', body: { saved: false } },
      { method: 'PUT', path: '/me/saved-venues/arena-one', status: 409, body: { error: { code: 'saved_venues_full', message: 'x' } } },
    ]);
    const { user } = renderApp('/venues/arena-one', { user: player });
    const button = await screen.findByRole('button', { name: en.savedVenues.save });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(await screen.findByText(en.errors.saved_venues_full)).toBeInTheDocument();
    expect(button).toHaveAccessibleName(en.savedVenues.save);
  });

  it('shows Saved for a venue already saved', async () => {
    mockApi([
      { path: '/venues/arena-one', body: { venue } },
      { path: '/me/saved-venues/arena-one', body: { saved: true } },
    ]);
    renderApp('/venues/arena-one', { user: player });
    expect(await screen.findByRole('button', { name: en.savedVenues.saved })).toBeEnabled();
  });
});

describe('saved tab in my bookings', () => {
  const open = async (routes: Parameters<typeof mockApi>[0]) => {
    const m = mockApi([{ path: '/me/bookings', body: { bookings: [] } }, { path: '/me/series', body: { series: [] } }, ...routes]);
    const r = renderApp('/me/bookings', { user: player });
    await r.user.click(await screen.findByRole('tab', { name: en.myBookings.saved }));
    return { ...r, m };
  };

  it('lists saved venues linking to their pages, and removes one', async () => {
    const { user, m } = await open([
      {
        method: 'GET',
        path: '/me/saved-venues',
        body: { venues: [saved('arena-one', { rating: { average: 4.5, count: 3 } }), saved('arena-two', { photo: { url: 'http://x/1.jpg' } })] },
      },
      { method: 'DELETE', path: '/me/saved-venues/arena-one', status: 204 },
    ]);
    const panel = screen.getByRole('tabpanel');
    const links = await within(panel).findAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Venue arena-one', '/venues/arena-one'],
      ['Venue arena-two', '/venues/arena-two'],
    ]);
    expect(within(panel).getByRole('img', { name: /4\.5/ })).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Remove Venue arena-one from saved' }));
    expect(within(panel).queryByText('Venue arena-one')).not.toBeInTheDocument();
    await waitFor(() => expect(m.calls.some((c) => c.method === 'DELETE' && c.path === '/me/saved-venues/arena-one')).toBe(true));
  });

  it('a failed remove puts the venue back and says so', async () => {
    const { user } = await open([
      { method: 'GET', path: '/me/saved-venues', body: { venues: [saved('arena-one')] } },
      { method: 'DELETE', path: '/me/saved-venues/arena-one', status: 500, body: { error: { code: 'internal', message: 'x' } } },
    ]);
    await user.click(await screen.findByRole('button', { name: 'Remove Venue arena-one from saved' }));
    expect(await screen.findByText(en.errors.generic)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Venue arena-one' })).toBeInTheDocument();
  });

  it('empty: says how to save and links to search', async () => {
    await open([{ method: 'GET', path: '/me/saved-venues', body: { venues: [] } }]);
    expect(await screen.findByText(en.savedVenues.empty)).toBeInTheDocument();
    expect(screen.getByText(en.savedVenues.emptyHint)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.myBookings.findVenues })).toHaveAttribute('href', '/search');
    await i18n.changeLanguage('ru');
    expect(await screen.findByText(ru.savedVenues.empty)).toBeInTheDocument();
  });
});
