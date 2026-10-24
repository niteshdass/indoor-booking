import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import { mockApi } from '../helpers/api';
import { renderApp } from '../helpers/render';
import type { PublicVenue } from '../../src/lib/types';

const venue: PublicVenue = {
  slug: 'arena-one',
  name: 'Arena One',
  address: 'Road 1',
  city: 'Dhaka',
  country: 'BD',
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
  location: { lat: 1, lng: 2 },
  photos: [{ url: 'http://x/1.jpg', alt: 'Pitch view' }, { url: 'http://x/2.jpg' }],
  amenities: ['parking', 'wifi'],
  turfs: [
    { id: 't1', name: 'Court A', sports: ['futsal'], indoor: true, slotLengthMin: 60 },
    { id: 't2', name: 'Court B', sports: ['tennis'], indoor: false, slotLengthMin: 60 },
  ],
};

beforeEach(() => i18n.changeLanguage('en'));
afterEach(() => vi.unstubAllGlobals());

describe('VenuePage', () => {
  it('renders venue details and amenities', async () => {
    mockApi([{ path: '/venues/arena-one', body: { venue } }]);
    renderApp('/venues/arena-one?date=2026-10-25');
    expect(await screen.findByRole('heading', { name: 'Arena One' })).toBeInTheDocument();
    expect(screen.getByText(/Road 1/)).toBeInTheDocument();
    expect(screen.getByText(en.sports.futsal)).toBeInTheDocument();
    expect(screen.getByText(en.amenities.parking)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Court A/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByAltText('Pitch view')).toBeInTheDocument();
    expect(screen.getByAltText('Arena One')).toBeInTheDocument();
    await i18n.changeLanguage('ru');
    expect(await screen.findByText(ru.amenities.parking)).toBeInTheDocument();
  });

  it('turf tab switch updates URL', async () => {
    mockApi([{ path: '/venues/arena-one', body: { venue } }]);
    const { user, location } = renderApp('/venues/arena-one?date=2026-10-25');
    await user.click(await screen.findByRole('tab', { name: /Court B/ }));
    await waitFor(() => expect(location().search).toContain('turf=t2'));
    expect(location().search).toContain('date=2026-10-25');
    expect(screen.getByRole('tab', { name: /Court B/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(location().search).toContain('turf=t1'));
  });

  it('unknown turf falls back to the first; malformed date to today', async () => {
    mockApi([{ path: '/venues/arena-one', body: { venue } }]);
    renderApp('/venues/arena-one?turf=nope&date=garbage');
    expect(await screen.findByRole('tab', { name: /Court A/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('unknown slug shows not found', async () => {
    mockApi([{ path: '/venues/nope', status: 404, body: { error: { code: 'not_found', message: 'x' } } }]);
    renderApp('/venues/nope');
    expect(await screen.findByText(en.notFound.title)).toBeInTheDocument();
  });

  it('other errors show an alert with retry', async () => {
    mockApi([{ path: '/venues/arena-one', status: 500, body: { error: { code: 'internal', message: 'x' } } }]);
    renderApp('/venues/arena-one');
    expect(await screen.findByText(en.errors.generic)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.search.retry })).toBeInTheDocument();
  });

  it('no photos shows placeholder', async () => {
    mockApi([{ path: '/venues/arena-one', body: { venue: { ...venue, photos: [] } } }]);
    renderApp('/venues/arena-one');
    await screen.findByRole('heading', { name: 'Arena One' });
    expect(screen.getByTestId('photo-placeholder')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('venue without turfs shows an empty state and no tablist', async () => {
    mockApi([{ path: '/venues/arena-one', body: { venue: { ...venue, turfs: [] } } }]);
    renderApp('/venues/arena-one');
    expect(await screen.findByText(en.venue.noTurfs)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});
