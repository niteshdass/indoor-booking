import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { availableActions } from '../../src/owner/bookings/availableActions';
import type { BookingDetail, Permission } from '../../src/owner/types';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, ownerBooking, ownerRoutes, slotDay, staffUser, turf } from './fixtures';

const NOW = '2026-10-25T00:00:00.000Z';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const PERMS: Permission[] = ['booking.view', 'booking.reschedule'];
const can = (perms: Permission[]) => (p: Permission) => perms.includes(p);
const detail = (over: Partial<BookingDetail> = {}): BookingDetail => ({ booking: ownerBooking(), payments: [], refunds: [], ...over });
const URL_ = `/owner/${OWNER_ID}/bookings/b1`;
const GET = '/owners/o1/bookings/b1';
const TURFS = '/owners/o1/venues/v1/turfs';
const SLOTS = /^\/owners\/o1\/venues\/v1\/turfs\/t[12]\/slots$/;
const M = en.owner.bookings;

// 10:00 and 11:00 in Dhaka on 26 Oct.
const twoSlots = () =>
  slotDay({
    slots: [
      { startAt: '2026-10-26T04:00:00.000Z', endAt: '2026-10-26T05:00:00.000Z', localStart: '10:00', localEnd: '11:00', price: 1000, status: 'available', source: 'hours' },
      { startAt: '2026-10-26T05:00:00.000Z', endAt: '2026-10-26T06:00:00.000Z', localStart: '11:00', localEnd: '12:00', price: 1200, status: 'available', source: 'hours' },
    ],
  });

describe('availableActions move', () => {
  const now = Date.parse(NOW);
  it('offers move for pending and confirmed bookings that have not ended, with booking.reschedule', () => {
    expect(availableActions(ownerBooking({ status: 'pending' }), can(PERMS), now)).toEqual(['move']);
    expect(availableActions(ownerBooking({ status: 'confirmed', amountPaid: 1000 }), can(PERMS), now)).toEqual(['move']);
    expect(availableActions(ownerBooking({ status: 'pending' }), can(['booking.view']), now)).toEqual([]);
    expect(availableActions(ownerBooking({ status: 'completed', amountPaid: 1000 }), can(PERMS), now)).toEqual([]);
    expect(availableActions(ownerBooking({ status: 'cancelled' }), can(PERMS), now)).toEqual([]);
    // Its last slot ended at 05:00Z on 26 Oct.
    expect(availableActions(ownerBooking({ status: 'confirmed' }), can(PERMS), Date.parse('2026-10-26T05:00:00.000Z'))).toEqual([]);
  });

  it('places move before cancel', () => {
    const all = can([...PERMS, 'booking.confirm', 'booking.cancel']);
    expect(availableActions(ownerBooking({ status: 'pending' }), all, now)).toEqual(['confirm', 'reject', 'move', 'cancel']);
  });
});

describe('owner move booking', () => {
  it('moves the booking to another turf and posts turfId, date and starts', async () => {
    const moved = ownerBooking({
      turfId: 't2',
      turf: { name: 'Pitch B' },
      slots: [{ startAt: '2026-10-26T05:00:00.000Z', endAt: '2026-10-26T06:00:00.000Z', price: 1000 }],
      rescheduleCount: 1,
      rescheduledAt: NOW,
    });
    const api = mockApi([
      ...ownerRoutes({ permissions: PERMS }),
      { method: 'POST', path: `${GET}/reschedule`, body: { booking: moved } },
      { path: TURFS, body: { turfs: [turf(), turf({ id: 't2', name: 'Pitch B' }), turf({ id: 't3', name: 'Old pitch', active: false })] } },
      { path: SLOTS, body: { day: twoSlots() } },
      { path: GET, body: detail() },
    ]);
    const { user } = renderApp(URL_, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: M.actions.move }));
    const dialog = await screen.findByRole('dialog', { name: en.reschedule.staffTitle });
    expect(within(dialog).getByText(en.reschedule.priceKeptStaff)).toBeTruthy();
    const court = await within(dialog).findByLabelText(en.reschedule.court);
    expect(within(court).getAllByRole('option').map((o) => o.textContent)).toEqual(['Pitch A', 'Pitch B']);
    expect((court as HTMLSelectElement).value).toBe('t1');
    await user.selectOptions(court, 't2');
    await waitFor(() => expect(api.calls.some((c) => c.path === `${TURFS}/t2/slots`)).toBe(true));
    const eleven = await within(dialog).findByRole('button', { name: /^11:00/ });
    await waitFor(() => expect(eleven).toBeEnabled());
    await user.click(eleven);
    // Staff have no price check: the dearer slot is fine.
    await user.click(within(dialog).getByRole('button', { name: en.reschedule.confirm }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.calls.find((c) => c.method === 'POST')!.body).toEqual({ turfId: 't2', date: '2026-10-26', startAts: ['2026-10-26T05:00:00.000Z'] });
    expect(await screen.findByText(M.moved)).toBeTruthy();
    expect(screen.getByText(/Pitch B/)).toBeTruthy();
  });

  it('shows a refusal and offers no move without booking.reschedule', async () => {
    mockApi([
      ...ownerRoutes({ permissions: PERMS }),
      { method: 'POST', path: `${GET}/reschedule`, status: 409, body: { error: { code: 'turf_change_not_allowed', message: 'no' } } },
      { path: TURFS, body: { turfs: [turf(), turf({ id: 't2', name: 'Pitch B' })] } },
      { path: SLOTS, body: { day: twoSlots() } },
      { path: GET, body: detail() },
    ]);
    const { user } = renderApp(URL_, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: M.actions.move }));
    const dialog = await screen.findByRole('dialog');
    const eleven = await within(dialog).findByRole('button', { name: /^11:00/ });
    await user.click(eleven);
    await user.click(within(dialog).getByRole('button', { name: en.reschedule.confirm }));
    expect(await within(dialog).findByText(en.errors.turf_change_not_allowed)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: en.reschedule.confirm })).toBeNull();
  });

  it('hides move for members without booking.reschedule', async () => {
    mockApi([...ownerRoutes({ permissions: ['booking.view', 'booking.cancel'] }), { path: GET, body: detail() }]);
    renderApp(URL_, { user: staffUser });
    expect(await screen.findByText('BK-0001')).toBeTruthy();
    expect(screen.getByRole('button', { name: M.actions.cancel })).toBeTruthy();
    expect(screen.queryByRole('button', { name: M.actions.move })).toBeNull();
  });

  it('lists how often a booking was moved', async () => {
    mockApi([
      ...ownerRoutes({ permissions: PERMS }),
      { path: GET, body: detail({ booking: ownerBooking({ rescheduleCount: 2, rescheduledAt: '2026-10-24T08:30:00.000Z' }) }) },
    ]);
    renderApp(URL_, { user: staffUser });
    expect(await screen.findByText(M.moved)).toBeTruthy();
    // 08:30Z is 14:30 in Dhaka.
    expect(screen.getByText(/14:30.*\(2 times\)/)).toBeTruthy();
  });
});
