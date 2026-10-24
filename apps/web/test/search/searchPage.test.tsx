import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { SearchResult } from '@booking/shared';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import { money } from '../../src/lib/format';
import { mockApi, type Call } from '../helpers/api';
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

  it('shows an error alert with retry when rate limited', async () => {
    mockApi([{ path: '/search', status: 429, body: { error: { code: 'rate_limited', message: 'x' } } }]);
    renderApp('/');
    expect(await screen.findByText(en.errors.rate_limited)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.search.retry })).toBeInTheDocument();
  });

  it('card shows the no-price and no-free-slot strings', async () => {
    mockApi([{ path: '/search', body: { results: [{ ...venue, fromPrice: null, nextFreeSlot: null }], nextCursor: null } }]);
    renderApp('/');
    expect(await screen.findByText(en.search.noPrice)).toBeInTheDocument();
    expect(screen.getByText(en.search.noFreeSlot)).toBeInTheDocument();
  });

  it('distance: null shows none, 0 shows 0 m', async () => {
    mockApi([{ path: '/search', body: { results: [{ ...venue, distanceMeters: null }], nextCursor: null } }]);
    const first = renderApp('/');
    const card = await screen.findByRole('link', { name: 'Arena One' });
    expect(card.textContent).not.toMatch(/\d\s?(k?m)\b/);
    first.unmount();
    vi.unstubAllGlobals();
    mockApi([{ path: '/search', body: { results: [{ ...venue, distanceMeters: 0 }], nextCursor: null } }]);
    renderApp('/');
    expect(await screen.findByText(/0\s?m\b/)).toBeInTheDocument();
  });

  it('link accessible name is exactly the venue name and the photo is decorative', async () => {
    mockApi([{ path: '/search', body: { results: [{ ...venue, photo: { url: 'http://x/p.jpg', alt: 'Arena One photo' } }], nextCursor: null } }]);
    const { container } = renderApp('/');
    expect(await screen.findByRole('link', { name: 'Arena One' })).toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('Load more appends results; the count shows N+ while more remain', async () => {
    const full = Array.from({ length: 20 }, (_, i) => ({ ...venue, slug: `v${i}`, name: `Venue ${i}` }));
    mockApi([
      {
        path: '/search',
        body: (c: Call) =>
          c.query.get('cursor') === '0'
            ? { results: full, nextCursor: 20 }
            : { results: [{ ...venue, slug: 'last', name: 'Last Venue' }], nextCursor: null },
      },
    ]);
    const { user } = renderApp('/');
    expect(await screen.findByText('Venue 0')).toBeInTheDocument();
    expect(screen.getByText('20+ venues')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.search.loadMore }));
    expect(await screen.findByText('Last Venue')).toBeInTheDocument();
    expect(screen.getByText('Venue 0')).toBeInTheDocument();
    expect(screen.getByText('21 venues')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.search.loadMore })).not.toBeInTheDocument();
  });

  it('ru plural forms for count and countMore', async () => {
    const t = (k: string, count: number) => i18n.t(k, { count, lng: 'ru' });
    expect([1, 2, 5, 21].map((n) => t('search.count', n))).toEqual(['1 площадка', '2 площадки', '5 площадок', '21 площадка']);
    expect([20, 22, 21].map((n) => t('search.countMore', n))).toEqual(['20+ площадок', '22+ площадки', '21+ площадка']);
  });

  describe('criteria change', () => {
    function gateTennis() {
      const inner = globalThis.fetch;
      let open!: () => void;
      const gate = new Promise<void>((r) => (open = r));
      vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('sport=tennis') ? gate.then(() => inner(input, init)) : inner(input, init),
      );
      return open;
    }

    it('drops the old cards while the new response is pending', async () => {
      mockApi([
        {
          path: '/search',
          body: (c: Call) => ({
            results: [c.query.get('sport') === 'tennis' ? { ...venue, slug: 't', name: 'Tennis Hall' } : venue],
            nextCursor: null,
          }),
        },
      ]);
      const release = gateTennis();
      const { user } = renderApp('/');
      expect(await screen.findByText('Arena One')).toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText(en.search.sport), 'tennis');
      await user.click(screen.getByRole('button', { name: en.search.submit }));
      await waitFor(() => expect(screen.queryByText('Arena One')).not.toBeInTheDocument());
      release();
      expect(await screen.findByText('Tennis Hall')).toBeInTheDocument();
    });

    it('a failed first page of new criteria shows no old cards beside the alert', async () => {
      mockApi([
        {
          path: '/search',
          body: (c: Call) =>
            c.query.get('sport') === 'tennis'
              ? { status: 500, body: { error: { code: 'internal', message: 'x' } } }
              : { results: [venue], nextCursor: null },
        },
      ]);
      const { user } = renderApp('/');
      expect(await screen.findByText('Arena One')).toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText(en.search.sport), 'tennis');
      await user.click(screen.getByRole('button', { name: en.search.submit }));
      expect(await screen.findByText(en.errors.generic)).toBeInTheDocument();
      expect(screen.queryByText('Arena One')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: en.search.loadMore })).not.toBeInTheDocument();
    });
  });
});
