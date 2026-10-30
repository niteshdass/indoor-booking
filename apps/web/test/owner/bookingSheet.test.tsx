import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { OwnerProvider } from '../../src/owner/OwnerProvider';
import { BookingSheet } from '../../src/owner/today/BookingSheet';
import type { OwnerBooking, Permission } from '../../src/owner/types';
import { mockApi, type Route as ApiRoute } from '../helpers/api';
import { OWNER_ID, ownerBooking, ownerRoutes, venue } from './fixtures';

const ALL: Permission[] = ['booking.view', 'booking.confirm', 'booking.cancel', 'booking.checkin', 'payment.mark_cash', 'booking.create'];
const A = en.owner.bookings.actions;
const S = en.owner.today.sheet;

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

const pending = ownerBooking({ id: 'b1', status: 'pending', customer: { name: 'Bob Pending', phone: '+8801711111111', email: null } });
const detail = (b: OwnerBooking) => ({ booking: b, payments: [], refunds: [] });

function renderSheet(booking: OwnerBooking, routes: ApiRoute[], permissions: Permission[] = ALL) {
  const api = mockApi([...ownerRoutes({ permissions }), ...routes]);
  const onChanged = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/owner/${OWNER_ID}`]}>
        <Routes>
          <Route
            path="/owner/:ownerId"
            element={
              <OwnerProvider>
                <BookingSheet booking={booking} venue={venue()} onClose={() => {}} onChanged={onChanged} />
              </OwnerProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
  return { api, onChanged, user: userEvent.setup() };
}

describe('BookingSheet', () => {
  it('BookingSheet shows the booking facts and a call link', async () => {
    renderSheet(pending, [{ path: '/owners/o1/bookings/b1', body: detail(pending) }]);
    const sheet = await screen.findByRole('dialog', { name: S.title });
    expect(within(sheet).getByText('Bob Pending')).toBeTruthy();
    expect(within(sheet).getByRole('link', { name: 'Call +8801711111111' }).getAttribute('href')).toBe('tel:+8801711111111');
    expect(within(sheet).getByText(en.owner.bookings.total)).toBeTruthy();
    expect(within(sheet).getByText(S.due)).toBeTruthy();
  });

  it('BookingSheet confirms a pending booking and tells Today to reload', async () => {
    const { api, onChanged, user } = renderSheet(pending, [
      { path: '/owners/o1/bookings/b1', body: (_c: unknown, n: number) => detail(n === 0 ? pending : { ...pending, status: 'confirmed' }) },
      { method: 'POST', path: '/owners/o1/bookings/b1/confirm', body: { booking: { ...pending, status: 'confirmed' } } },
    ]);
    const sheet = await screen.findByRole('dialog', { name: S.title });
    await user.click(await within(sheet).findByRole('button', { name: A.confirm }));
    await waitFor(() => expect(within(sheet).getByText(en.status.confirmed)).toBeTruthy());
    expect(api.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/owners/o1/bookings/b1/confirm']);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('BookingSheet reloads the booking on a 409', async () => {
    const { api, user } = renderSheet(pending, [
      { path: '/owners/o1/bookings/b1', body: (_c: unknown, n: number) => detail(n === 0 ? pending : { ...pending, status: 'confirmed' }) },
      { method: 'POST', path: '/owners/o1/bookings/b1/confirm', status: 409, body: { error: { code: 'conflict', message: 'changed' } } },
    ]);
    const sheet = await screen.findByRole('dialog', { name: S.title });
    await user.click(await within(sheet).findByRole('button', { name: A.confirm }));
    expect(await within(sheet).findByRole('button', { name: A.checkIn })).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: A.confirm })).toBeNull();
    expect(api.calls.filter((c) => c.method === 'GET' && c.path === '/owners/o1/bookings/b1')).toHaveLength(2);
  });

  it('BookingSheet shows facts only for a view-only member', async () => {
    renderSheet(pending, [{ path: '/owners/o1/bookings/b1', body: detail(pending) }], ['booking.view']);
    const sheet = await screen.findByRole('dialog', { name: S.title });
    await within(sheet).findByText('Bob Pending');
    expect(within(sheet).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([en.common.close]);
    expect(within(sheet).getByRole('link', { name: S.openBooking }).getAttribute('href')).toBe(`/owner/${OWNER_ID}/bookings/b1`);
  });
});
