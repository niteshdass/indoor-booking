import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import type { Overview } from '../../src/owner/overview/types';
import { niceTicks } from '../../src/owner/overview/charts';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, ownerBooking, ownerRoutes, staffUser } from './fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const day = (date: string, online: number, previous = 0) => ({
  date,
  online,
  walkin: 0,
  bookings: online > 0 ? 1 : 0,
  minutes: online > 0 ? 60 : 0,
  previous: { revenue: previous, bookings: previous > 0 ? 1 : 0, minutes: previous > 0 ? 60 : 0 },
});

function overview(over: Partial<Overview> = {}): Overview {
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  heatmap[4]![19] = 3;
  return {
    range: { from: '2026-10-21', to: '2026-10-27', days: 7, previous: { from: '2026-10-14', to: '2026-10-20' } },
    currency: 'BDT',
    timezone: 'Asia/Dhaka',
    platformFees: 0,
    kpis: {
      revenue: { value: 300000, previous: 200000 },
      bookings: { value: 3, previous: 4 },
      minutes: { value: 180, previous: 180 },
      utilization: { value: 0.25, previous: 0.2 },
      averageBooking: { value: 100000, previous: 50000 },
      cancellationRate: { value: 0.1, previous: 0.2 },
    },
    daily: [day('2026-10-21', 100000, 200000), day('2026-10-22', 0), day('2026-10-23', 200000)],
    mix: { courts: 250000, addons: 50000, cancellationFees: 0, collected: 200000, outstanding: 100000 },
    heatmap,
    courts: [{ id: 't1', name: 'Court A', revenue: 300000, bookings: 3, minutes: 180, openMinutes: 720, previousRevenue: 200000 }],
    statuses: { confirmed: 3, cancelled: 1 },
    players: { value: 3, previous: 2, newValue: 1, newPrevious: 0 },
    methods: [{ method: 'cash', amount: 200000, count: 2 }],
    recent: [ownerBooking({ id: 'b1', reference: 'BK0001', customer: { name: 'Rafi', phone: null, email: null } })],
    ...over,
  };
}

const routes = (body: Overview = overview()) => [
  ...ownerRoutes({ permissions: ['booking.view', 'reports.view'] }),
  { path: `/owners/${OWNER_ID}/reports/overview`, body },
];

describe('Overview page', () => {
  it('shows KPIs with the change against the previous period', async () => {
    const api = mockApi(routes());
    renderApp(`/owner/${OWNER_ID}/overview`, { user: staffUser });
    const kpi = (label: string) => screen.getAllByText(label).find((el) => el.tagName === 'P')!.closest('div')!;
    await screen.findByText(en.owner.overview.kpi.cancellations);
    const revenue = kpi(en.owner.overview.kpi.revenue);
    expect(revenue.textContent).toMatch(/BDT\s*3K/);
    expect(revenue.textContent).toMatch(/Up\s*50%/);
    const bookings = kpi(en.owner.overview.kpi.bookings);
    expect(bookings.textContent).toMatch(/Down\s*25%/);
    expect(kpi(en.owner.overview.kpi.hours).textContent).toContain(en.owner.overview.same);
    // Rates change in points; fewer cancellations is good.
    const cancel = kpi(en.owner.overview.kpi.cancellations);
    expect(cancel.textContent).toMatch(/Down\s*10 pt/);
    const call = api.calls.find((c) => c.path === `/owners/${OWNER_ID}/reports/overview`)!;
    expect(call.query.get('venueId')).toBe('v1');
    expect(call.query.get('days')).toBe('30');
  });

  it('reads the period from the URL and fills the cards', async () => {
    const api = mockApi(routes());
    renderApp(`/owner/${OWNER_ID}/overview?days=7`, { user: staffUser });
    expect(await screen.findByText(/Busiest: Friday from 19:00/)).toBeTruthy();
    expect(api.calls.find((c) => c.path === `/owners/${OWNER_ID}/reports/overview`)!.query.get('days')).toBe('7');
    const courts = screen.getByRole('table', { name: en.owner.overview.courts.title });
    expect(within(courts).getByText('Court A')).toBeTruthy();
    expect(within(courts).getByText('25%')).toBeTruthy();
    expect(screen.getByText(en.owner.overview.methods.cash)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'BK0001' }).getAttribute('href')).toBe(`/owner/${OWNER_ID}/bookings/b1`);
    // The daily figures are in a table for screen readers.
    expect(screen.getByRole('table', { name: 'Revenue by day' })).toBeTruthy();
  });

  it('shows the platform fee beside revenue only when there is one', async () => {
    mockApi(routes(overview({ platformFees: 5000 })));
    const { unmount } = renderApp(`/owner/${OWNER_ID}/overview`, { user: staffUser });
    const kpi = (label: string) => screen.getAllByText(label).find((el) => el.tagName === 'P')!.closest('div')!;
    await screen.findByText(en.owner.overview.kpi.cancellations);
    expect(kpi(en.owner.overview.kpi.revenue).textContent).toMatch(/after BDT\s*50 platform fee/i);
    const mixFee = screen.getByText(en.owner.overview.mix.platformFee, { selector: 'dt' });
    expect(mixFee.nextElementSibling).toHaveTextContent(/BDT\s50\.00/);
    unmount();

    mockApi(routes());
    renderApp(`/owner/${OWNER_ID}/overview`, { user: staffUser });
    await screen.findByText(en.owner.overview.kpi.cancellations);
    expect(screen.queryByText(/platform fee/i)).toBeNull();
  });

  it('switches the trend between revenue, bookings and hours', async () => {
    mockApi(routes());
    const { user } = renderApp(`/owner/${OWNER_ID}/overview`, { user: staffUser });
    await user.click(await screen.findByRole('tab', { name: en.owner.overview.trend.hours }));
    expect(screen.getByRole('table', { name: 'Hours by day' })).toBeTruthy();
  });

  it('is hidden without reports.view', async () => {
    mockApi([...ownerRoutes({ permissions: ['booking.view'] }), { path: `/owners/${OWNER_ID}/bookings`, body: { bookings: [] } }]);
    renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    await screen.findByRole('link', { name: en.owner.nav.schedule });
    expect(screen.queryByRole('link', { name: en.owner.nav.overview })).toBeNull();
  });

  it('niceTicks rounds the axis up to a readable step', () => {
    expect(niceTicks(0)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(9)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(410000)).toEqual([0, 150000, 300000, 450000]);
    expect(niceTicks(3, 1)).toEqual([0, 1, 2, 3]);
  });
});
