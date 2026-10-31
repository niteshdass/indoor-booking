import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import { mockApi } from '../helpers/api';
import { renderApp } from '../helpers/render';
import { setAccessToken } from '../../src/lib/apiClient';
import type { PublicUser, PublicVenue, SlotDay } from '../../src/lib/types';
import { seriesJson, seriesPreview } from '../owner/fixtures';

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
  turfs: [
    { id: 't1', name: 'Court A', sports: ['futsal'], indoor: true, slotLengthMin: 60 },
    { id: 't2', name: 'Court B', sports: ['tennis'], indoor: false, slotLengthMin: 60 },
  ],
};

const day: SlotDay = {
  businessDate: '2026-10-26',
  currency: 'BDT',
  status: 'open',
  slots: ['10:00', '11:00'].map((h, i) => ({
    startAt: `2026-10-26T0${4 + i}:00:00.000Z`,
    endAt: `2026-10-26T0${5 + i}:00:00.000Z`,
    localStart: h,
    localEnd: `${11 + i}:00`,
    price: 1000,
    status: 'available',
  })),
};

const URL = '/venues/arena-one/series?turfId=t1&date=2026-10-26';
const PREVIEW = '/venues/arena-one/turfs/t1/series/preview';
const CREATE = '/venues/arena-one/turfs/t1/series';

const baseRoutes = () => [
  { path: '/venues/arena-one', body: { venue } },
  { path: /^\/venues\/arena-one\/turfs\/t\d\/slots$/, body: { day } },
];

beforeEach(() => {
  setAccessToken(null);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-25T00:00:00.000Z'));
  return i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('request weekly booking', () => {
  it('signed-out user sees no request link', async () => {
    mockApi(baseRoutes());
    renderApp('/venues/arena-one?date=2026-10-26');
    await screen.findByRole('tab', { name: /Court A/ });
    await screen.findByText(/10:00|Pick|slot/i);
    expect(screen.queryByRole('link', { name: en.series.player.requestLink })).not.toBeInTheDocument();
  });

  it('signed-in user gets a request link carrying the court and date', async () => {
    mockApi(baseRoutes());
    renderApp('/venues/arena-one?date=2026-10-26', { user: player });
    const link = await screen.findByRole('link', { name: en.series.player.requestLink });
    expect(link).toHaveAttribute('href', '/venues/arena-one/series?turfId=t1&date=2026-10-26');
  });

  it('sends a signed-out visitor of the request page to sign in', async () => {
    mockApi(baseRoutes());
    const { location } = renderApp(URL);
    await waitFor(() => expect(location().pathname).toBe('/login'));
    expect(location().search).toContain('next=' + encodeURIComponent(URL));
  });

  it('check dates then send request posts the pattern and shows respondBy', async () => {
    const api = mockApi([
      ...baseRoutes(),
      { method: 'POST', path: PREVIEW, body: { preview: seriesPreview() } },
      {
        method: 'POST',
        path: CREATE,
        status: 201,
        body: { series: seriesJson({ status: 'requested', source: 'online', guest: null, respondBy: '2026-10-25T10:30:00.000Z' }) },
      },
    ]);
    const { user } = renderApp(URL, { user: player });
    await screen.findByRole('heading', { name: en.series.player.requestTitle });
    await waitFor(() => expect(screen.getByLabelText(en.series.startTime)).toHaveValue('10:00'));
    expect(screen.queryByRole('button', { name: en.series.player.send })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: en.series.check }));
    const list = await screen.findByRole('list', { name: en.series.previewLabel });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(api.calls.find((c) => c.path === PREVIEW)?.body).toEqual({
      weekdays: ['mon'],
      startTime: '10:00',
      slotCount: 1,
      firstDate: '2026-10-26',
      endDate: null,
      count: 10,
    });

    await user.click(screen.getByRole('button', { name: en.series.player.send }));
    // 2026-10-25T10:30Z is 16:30 in Asia/Dhaka.
    const sent = await screen.findByText(/Request sent\. The venue will answer by .*16:30/);
    expect(sent).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === CREATE)?.body).toMatchObject({ weekdays: ['mon'], startTime: '10:00', count: 10 });
    expect(screen.getByRole('link', { name: en.series.player.toBookings })).toHaveAttribute('href', '/me/bookings');
  });

  it.each([
    ['player', true],
    ['owner', false],
  ] as const)('the preview shows the platform fee only when the player pays it (%s)', async (payer, shown) => {
    // The total from the API already includes a player-paid fee.
    const preview = seriesPreview({ total: payer === 'player' ? 2100 : 2000, platformFee: { payer, perGame: [50, 50] } });
    mockApi([...baseRoutes(), { method: 'POST', path: PREVIEW, body: { preview } }]);
    const { user } = renderApp(URL, { user: player });
    await waitFor(() => expect(screen.getByLabelText(en.series.startTime)).toHaveValue('10:00'));
    await user.click(screen.getByRole('button', { name: en.series.check }));
    await screen.findByRole('list', { name: en.series.previewLabel });
    const fee = screen.queryByText(/platform fee/);
    if (shown) {
      expect(fee).toHaveTextContent(/^Includes BDT\s1\.00 platform fee$/);
      expect(screen.getByText(/2 games ·/)).toHaveTextContent(/BDT\s21\.00/);
    } else {
      expect(fee).toBeNull();
      expect(screen.getByText(/2 games ·/)).toHaveTextContent(/BDT\s20\.00/);
    }
  });

  it('series_request_limit shows the translated error', async () => {
    mockApi([
      ...baseRoutes(),
      { method: 'POST', path: PREVIEW, body: { preview: seriesPreview() } },
      { method: 'POST', path: CREATE, status: 409, body: { error: { code: 'series_request_limit', message: 'x' } } },
    ]);
    const { user } = renderApp(URL, { user: player });
    await waitFor(() => expect(screen.getByLabelText(en.series.startTime)).toHaveValue('10:00'));
    await user.click(screen.getByRole('button', { name: en.series.check }));
    await user.click(await screen.findByRole('button', { name: en.series.player.send }));
    expect(await screen.findByText(en.errors.series_request_limit)).toBeInTheDocument();
    expect(screen.queryByText(/Request sent/)).not.toBeInTheDocument();
  });

  it('renders in Russian', async () => {
    mockApi([...baseRoutes(), { method: 'POST', path: PREVIEW, body: { preview: seriesPreview() } }]);
    await i18n.changeLanguage('ru');
    const { user } = renderApp(URL, { user: player });
    expect(await screen.findByRole('heading', { name: ru.series.player.requestTitle })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(ru.series.startTime)).toHaveValue('10:00'));
    await user.click(screen.getByRole('button', { name: ru.series.check }));
    expect(await screen.findByRole('button', { name: ru.series.player.send })).toBeInTheDocument();
  });

  it('confirms without a date when the venue gave no answer-by time', async () => {
    mockApi([
      ...baseRoutes(),
      { method: 'POST', path: PREVIEW, body: { preview: seriesPreview() } },
      { method: 'POST', path: CREATE, status: 201, body: { series: seriesJson({ status: 'requested', respondBy: null }) } },
    ]);
    const { user } = renderApp(URL, { user: player });
    await waitFor(() => expect(screen.getByLabelText(en.series.startTime)).toHaveValue('10:00'));
    await user.click(screen.getByRole('button', { name: en.series.check }));
    await user.click(await screen.findByRole('button', { name: en.series.player.send }));
    expect(await screen.findByText(en.series.player.sentNoDate)).toBeInTheDocument();
  });
});
