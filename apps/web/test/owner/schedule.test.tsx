import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import { mockApi, type Route } from '../helpers/api';
import { OWNER_ID, ownerBooking, ownerRoutes, slotDay, staffUser, turf } from './fixtures';

const NOW = '2026-10-26T04:30:00.000Z'; // 10:30 in Dhaka, inside the 10:00-11:00 slot

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

const SLOT_2 = {
  startAt: '2026-10-26T05:00:00.000Z',
  endAt: '2026-10-26T06:00:00.000Z',
  localStart: '11:00',
  localEnd: '12:00',
  price: 1200,
  status: 'available' as const,
  source: 'hours' as const,
};

function scheduleRoutes(permissions: string[] = ['booking.view', 'booking.create'], bookings = [ownerBooking({ id: 'b1', status: 'confirmed', customer: { name: 'Ada Player', phone: null, email: null } })]): Route[] {
  const day = slotDay();
  return [
    ...ownerRoutes({ permissions: permissions as never }),
    { path: '/owners/o1/venues/v1/turfs', body: { turfs: [turf(), turf({ id: 't2', name: 'Pitch B', active: false })] } },
    {
      path: '/owners/o1/venues/v1/turfs/t1/slots',
      body: (call: { query: URLSearchParams }) => {
        const date = call.query.get('date');
        if (date === '2026-10-27') {
          return {
            day: slotDay({
              businessDate: date,
              slots: day.slots.map((s) => ({ ...s, startAt: '2026-10-27T04:00:00.000Z', endAt: '2026-10-27T05:00:00.000Z' })),
            }),
          };
        }
        return { day: { ...day, slots: [...day.slots.map((s) => ({ ...s, status: 'booked' as const })), SLOT_2] } };
      },
    },
    {
      path: '/owners/o1/bookings',
      body: { bookings },
    },
  ];
}

describe('Schedule page', () => {
  it('schedule shows booking blocks with customer names and links to detail', async () => {
    const api = mockApi(scheduleRoutes());
    renderApp(`/owner/${OWNER_ID}/schedule`, { user: staffUser });
    const link = await screen.findByRole('link', { name: /Ada Player/ });
    expect(link.getAttribute('href')).toBe(`/owner/${OWNER_ID}/bookings/b1`);
    expect(within(link).getByText(en.status.confirmed)).toBeTruthy();
    expect(screen.getByText('Pitch A')).toBeTruthy();
    expect(screen.queryByText('Pitch B')).toBeNull();
    const bookings = api.calls.find((c) => c.path === '/owners/o1/bookings')!;
    expect(bookings.query.get('venueId')).toBe('v1');
    expect(bookings.query.get('from')).toBe('2026-10-26');
    expect(bookings.query.get('to')).toBe('2026-10-26');
  });

  it('labels a missing customer by booking source', async () => {
    mockApi(
      scheduleRoutes(undefined, [
        ownerBooking({ id: 'w', status: 'confirmed', source: 'walkin', playerId: null, customer: null }),
        ownerBooking({ id: 'o', status: 'confirmed', source: 'online', customer: null }),
      ]),
    );
    renderApp(`/owner/${OWNER_ID}/schedule`, { user: staffUser });
    expect(await screen.findByText(en.owner.walkInGuest)).toBeTruthy();
    expect(screen.getByText(en.owner.unknownCustomer)).toBeTruthy();
  });

  it('clicking an available slot opens walk-in with the slot prefilled', async () => {
    mockApi(scheduleRoutes());
    const { user, location } = renderApp(`/owner/${OWNER_ID}/schedule`, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: /11:00/ }));
    expect(location().pathname).toBe(`/owner/${OWNER_ID}/walk-in`);
    const q = new URLSearchParams(location().search);
    expect(Object.fromEntries(q)).toEqual({ venue: 'v1', turf: 't1', date: '2026-10-26', start: SLOT_2.startAt });
  });

  it('member without booking.create cannot click slots', async () => {
    mockApi(scheduleRoutes(['booking.view']));
    renderApp(`/owner/${OWNER_ID}/schedule`, { user: staffUser });
    await screen.findByRole('link', { name: /Ada Player/ });
    expect(screen.getAllByText('11:00').length).toBeGreaterThan(0);
    expect(screen.getByText(/12\.00/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /11:00/ })).toBeNull();
  });

  it('current-time line renders only for today', async () => {
    mockApi(scheduleRoutes());
    const first = renderApp(`/owner/${OWNER_ID}/schedule`, { user: staffUser });
    await screen.findByRole('link', { name: /Ada Player/ });
    const line = screen.getByTestId('now-line');
    expect(line.getAttribute('aria-hidden')).toBe('true');
    expect(line.style.top).toContain('var(--schedule-row)');
    first.unmount();

    renderApp(`/owner/${OWNER_ID}/schedule?date=2026-10-27`, { user: staffUser });
    await screen.findByRole('button', { name: /10:00/ });
    expect(screen.queryByTestId('now-line')).toBeNull();
  });
});
