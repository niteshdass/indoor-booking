import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import type { BookingGroup } from '../../src/owner/types';
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

const URL_ = `/owner/${OWNER_ID}/booking-groups/g1`;
const GET = '/owners/o1/booking-groups/g1';
const b1 = ownerBooking({ id: 'b1', reference: 'BK-0001', groupId: 'g1', status: 'confirmed' });
const b2 = ownerBooking({ id: 'b2', reference: 'BK-0002', businessDate: '2026-10-27', groupId: 'g1', status: 'confirmed', amountPaid: 400 });
const group = (over: Partial<BookingGroup> = {}): BookingGroup => ({ bookings: [b1, b2], refunds: [], ...over });

describe('owner booking group page', () => {
  it('lists every booking with links and sums the money', async () => {
    mockApi([...ownerRoutes(), { path: GET, body: group() }]);
    const { user, location } = renderApp(URL_, { user: staffUser });
    const table = await screen.findByRole('table', { name: en.owner.bookings.group.list });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    const summary = screen.getByRole('region', { name: en.owner.bookings.slots });
    expect(within(summary).getByText(en.owner.bookings.group.due).nextElementSibling!.textContent).toMatch(/16\.00/);
    // staff without payment.mark_cash or booking.cancel see no group actions
    expect(screen.queryByRole('button', { name: en.owner.bookings.group.cashAll })).toBeNull();
    expect(screen.queryByRole('button', { name: en.owner.bookings.group.cancelAll })).toBeNull();
    await user.click(within(table).getByRole('link', { name: 'BK-0002' }));
    await waitFor(() => expect(location().pathname).toBe(`/owner/${OWNER_ID}/bookings/b2`));
  });

  it('mark cash paid for all posts once and reloads', async () => {
    const paid = group({ bookings: [{ ...b1, amountPaid: b1.total, paymentStatus: 'paid' }, { ...b2, amountPaid: b2.total, paymentStatus: 'paid' }] });
    const api = mockApi([
      ...ownerRoutes({ permissions: ['booking.view', 'payment.mark_cash'] }),
      { path: GET, body: (_c: unknown, n: number) => (n === 0 ? group() : paid) },
      { path: `${GET}/payments/cash`, method: 'POST', status: 201, body: paid },
    ]);
    const { user } = renderApp(URL_, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.owner.bookings.group.cashAll }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/16\.00/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: en.owner.bookings.group.cashConfirm }));
    await waitFor(() => expect(screen.queryByRole('button', { name: en.owner.bookings.group.cashAll })).toBeNull());
    expect(api.calls.filter((c) => c.path === `${GET}/payments/cash`)).toHaveLength(1);
  });

  it('cancel all sends the reason', async () => {
    const api = mockApi([
      ...ownerRoutes({ permissions: ['booking.view', 'booking.cancel'] }),
      { path: GET, body: group() },
      { path: `${GET}/cancel`, method: 'POST', body: { bookings: [], refunds: [] } },
    ]);
    const { user } = renderApp(URL_, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.owner.bookings.group.cancelAll }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel 2 bookings?' });
    await user.type(within(dialog).getByLabelText(en.owner.bookings.reason.label), 'rain');
    await user.click(within(dialog).getByRole('button', { name: en.owner.bookings.group.cancelConfirm }));
    await waitFor(() => expect(api.calls.find((c) => c.path === `${GET}/cancel`)!.body).toEqual({ reason: 'rain' }));
  });

  it('an unknown group says so', async () => {
    mockApi([...ownerRoutes(), { path: GET, status: 404, body: { error: { code: 'not_found', message: 'x' } } }]);
    renderApp(URL_, { user: staffUser });
    expect(await screen.findByText(en.owner.bookings.group.notFound)).toBeTruthy();
  });
});
