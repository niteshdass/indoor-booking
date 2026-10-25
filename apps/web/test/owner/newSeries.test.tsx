import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import type { Permission } from '../../src/owner/types';
import { renderApp } from '../helpers/render';
import { mockApi, type Route } from '../helpers/api';
import { OWNER_ID, ownerRoutes, seriesJson, seriesPreview, slotDay, staffUser, turf } from './fixtures';

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

const URL_ = `/owner/${OWNER_ID}/series/new?venue=v1`;
const BASE = '/owners/o1/venues/v1/turfs/t1';
const PERMS: Permission[] = ['booking.view', 'booking.create'];

function routes(over: { preview?: Partial<Route>; create?: Partial<Route>; perms?: Permission[] } = {}): Route[] {
  return [
    ...ownerRoutes({ permissions: over.perms ?? PERMS }),
    { path: '/owners/o1/venues/v1/turfs', body: { turfs: [turf()] } },
    { path: `${BASE}/slots`, body: { day: slotDay() } },
    { method: 'POST', path: `${BASE}/series/preview`, body: { preview: seriesPreview() }, ...over.preview },
    { method: 'POST', path: `${BASE}/series`, status: 201, body: { series: seriesJson({ id: 's9' }) }, ...over.create },
  ];
}

async function check(user: ReturnType<typeof renderApp>['user']) {
  await screen.findByLabelText(en.series.startTime);
  await waitFor(() => expect((screen.getByLabelText(en.series.startTime) as HTMLSelectElement).value).toBe('10:00'));
  await user.click(screen.getByRole('button', { name: en.series.check }));
}

describe('New series page', () => {
  it('nav shows Series with booking.view', async () => {
    mockApi(routes({ perms: ['booking.view'] }));
    renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    const nav = await screen.findByRole('navigation', { name: en.owner.nav.label });
    expect(Array.from(nav.querySelectorAll('a')).map((a) => a.textContent)).toContain(en.owner.nav.series);
  });

  it('check dates posts the pattern and shows the preview; book posts the customer and navigates', async () => {
    const api = mockApi(routes());
    const { user, location } = renderApp(URL_, { user: staffUser });
    await check(user);
    const previewCall = await waitFor(() => {
      const c = api.calls.find((x) => x.path.endsWith('/series/preview'));
      expect(c).toBeTruthy();
      return c!;
    });
    expect(previewCall.body).toEqual({ weekdays: ['tue'], startTime: '10:00', slotCount: 1, firstDate: '2026-10-27', endDate: null, count: 10 });
    expect(await screen.findByText(en.series.reason.taken)).toBeTruthy();

    await user.type(screen.getByLabelText(en.owner.walkIn.name), 'Ada Walker');
    await user.type(screen.getByLabelText(en.auth.phone.number), '1712345678');
    await user.click(screen.getByRole('button', { name: /Book 2 games/ }));
    await waitFor(() => expect(location().pathname).toBe(`/owner/${OWNER_ID}/series/s9`));
    const create = api.calls.find((x) => x.method === 'POST' && x.path === `${BASE}/series`)!;
    expect(create.body).toMatchObject({ weekdays: ['tue'], count: 10, customer: { name: 'Ada Walker' } });
  });

  it('changing a field clears the preview', async () => {
    mockApi(routes());
    const { user } = renderApp(URL_, { user: staffUser });
    await check(user);
    await screen.findByText(en.series.reason.taken);
    await user.click(screen.getByRole('button', { name: 'Wed' }));
    expect(screen.queryByText(en.series.reason.taken)).toBeNull();
  });

  it('book disabled when no free dates', async () => {
    mockApi(routes({ preview: { body: { preview: seriesPreview({ freeCount: 0, total: 0, dates: [{ date: '2026-10-26', status: 'clash', reason: 'closed' }] }) } } }));
    const { user } = renderApp(URL_, { user: staffUser });
    await check(user);
    await screen.findByText(en.series.reason.closed);
    expect((screen.getByRole('button', { name: /Book 0 games/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('series_too_long shows the translated error', async () => {
    mockApi(routes({ preview: { status: 400, body: { error: { code: 'series_too_long', message: 'x' } } } }));
    const { user } = renderApp(URL_, { user: staffUser });
    await check(user);
    expect(await screen.findByText(en.errors.series_too_long)).toBeTruthy();
  });

  it('renders in Russian', async () => {
    await i18n.changeLanguage('ru');
    mockApi(routes());
    const { user } = renderApp(URL_, { user: staffUser });
    expect(await screen.findByText(ru.series.newTitle)).toBeTruthy();
    await screen.findByLabelText(ru.series.startTime);
    expect(screen.getByRole('button', { name: 'пн' })).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText(ru.series.startTime) as HTMLSelectElement).value).toBe('10:00'));
    await user.click(screen.getByRole('button', { name: ru.series.check }));
    expect(await screen.findByText(ru.series.reason.taken)).toBeTruthy();
  });
});
