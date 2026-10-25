import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { availableActions } from '../../src/owner/bookings/availableActions';
import type { BookingDetail, Permission } from '../../src/owner/types';
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

const OWNER_PERMS: Permission[] = ['booking.view', 'booking.confirm', 'booking.cancel', 'booking.checkin', 'booking.create', 'payment.mark_cash'];
const STAFF_PERMS: Permission[] = ['booking.view', 'booking.checkin', 'booking.create'];
const can = (perms: Permission[]) => (p: Permission) => perms.includes(p);

describe('availableActions', () => {
  it('availableActions per status and permission', () => {
    const b = (over: Parameters<typeof ownerBooking>[0]) => ownerBooking(over);
    const owner = can(OWNER_PERMS);
    const staff = can(STAFF_PERMS);
    expect(availableActions(b({ status: 'pending' }), owner)).toEqual(['confirm', 'reject', 'cancel', 'markCash']);
    expect(availableActions(b({ status: 'pending' }), staff)).toEqual([]);
    expect(availableActions(b({ status: 'awaiting_payment', source: 'walkin' }), owner)).toEqual(['cancel', 'paymentLink']);
    expect(availableActions(b({ status: 'awaiting_payment', source: 'online' }), owner)).toEqual(['cancel']);
    expect(availableActions(b({ status: 'awaiting_payment', source: 'walkin' }), staff)).toEqual(['paymentLink']);
    expect(availableActions(b({ status: 'confirmed', amountPaid: 1000 }), owner)).toEqual(['cancel', 'checkIn', 'noShow']);
    expect(availableActions(b({ status: 'confirmed', amountPaid: 400 }), staff)).toEqual(['checkIn', 'noShow']);
    expect(availableActions(b({ status: 'completed', amountPaid: 400 }), owner)).toEqual(['markCash']);
    expect(availableActions(b({ status: 'completed', amountPaid: 1000 }), owner)).toEqual([]);
    expect(availableActions(b({ status: 'cancelled' }), owner)).toEqual([]);
  });
});

const detail = (over: Partial<BookingDetail> = {}): BookingDetail => ({ booking: ownerBooking(), payments: [], refunds: [], ...over });
const URL_ = `/owner/${OWNER_ID}/bookings/b1`;
const GET = '/owners/o1/bookings/b1';

describe('owner booking detail', () => {
  it('booking detail shows customer, slots in venue time and totals', async () => {
    mockApi([
      ...ownerRoutes(),
      {
        path: GET,
        body: detail({
          booking: ownerBooking({
            status: 'confirmed',
            amountPaid: 600,
            subtotal: 1000,
            addonsTotal: 200,
            total: 1200,
            advanceRequired: 600,
            addons: [{ addonId: 'a1', name: 'Bibs', pricingType: 'per_unit', quantity: 2, unitPrice: 100, total: 200 } as never],
          }),
          payments: [
            { id: 'p1', method: 'cash', gateway: null, amount: 600, currency: 'BDT', status: 'succeeded', recordedBy: 'u9', createdAt: '2026-10-25T01:00:00.000Z' },
          ],
        }),
      },
    ]);
    renderApp(URL_, { user: staffUser });
    expect(await screen.findByText('BK-0001')).toBeTruthy();
    expect(screen.getByText(en.status.confirmed)).toBeTruthy();
    expect(screen.getByText('Arena One')).toBeTruthy();
    expect(screen.getByText(/Pitch A/)).toBeTruthy();
    // 04:00Z is 10:00 in Dhaka.
    expect(screen.getAllByText(/10:00/).length).toBeGreaterThan(0);
    expect(screen.getByText('Ada Player')).toBeTruthy();
    expect(screen.getByRole('link', { name: '+8801712345678' }).getAttribute('href')).toBe('tel:+8801712345678');
    expect(screen.getByText(/Bibs/)).toBeTruthy();
    expect(screen.getAllByText(/BDT\s12\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/BDT\s6\.00/).length).toBeGreaterThan(0);
  });

  it('booking detail hides actions the member lacks', async () => {
    mockApi([...ownerRoutes(), { path: GET, body: detail() }]);
    renderApp(URL_, { user: staffUser });
    await screen.findByText('BK-0001');
    for (const k of ['confirm', 'reject', 'cancel', 'checkIn', 'noShow'] as const) {
      expect(screen.queryByRole('button', { name: en.owner.bookings.actions[k] })).toBeNull();
    }
  });

  it('confirm posts once even when double-clicked and updates the status', async () => {
    const api = mockApi([
      ...ownerRoutes({ permissions: OWNER_PERMS }),
      { path: GET, body: detail() },
      { method: 'POST', path: `${GET}/confirm`, body: { booking: ownerBooking({ status: 'confirmed' }) } },
    ]);
    const { user } = renderApp(URL_, { user: staffUser });
    const btn = await screen.findByRole('button', { name: en.owner.bookings.actions.confirm });
    await user.dblClick(btn);
    expect(await screen.findByText(en.status.confirmed)).toBeTruthy();
    expect(api.calls.filter((c) => c.method === 'POST' && c.path === `${GET}/confirm`)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: en.owner.bookings.actions.confirm })).toBeNull();
  });

  it('a 409 on confirm shows the error and reloads the booking', async () => {
    const api = mockApi([
      ...ownerRoutes({ permissions: OWNER_PERMS }),
      { method: 'GET', path: GET, body: (_c: unknown, n: number) => detail({ booking: ownerBooking({ status: n === 0 ? 'pending' : 'cancelled' }) }) },
      { method: 'POST', path: `${GET}/confirm`, status: 409, body: { error: { code: 'invalid_transition', message: 'no' } } },
    ]);
    const { user } = renderApp(URL_, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.owner.bookings.actions.confirm }));
    expect((await screen.findByRole('alert')).textContent).toContain(en.errors.invalid_transition);
    await waitFor(() => expect(screen.getByText(en.status.cancelled)).toBeTruthy());
    expect(api.calls.filter((c) => c.method === 'GET' && c.path === GET)).toHaveLength(2);
  });

  it('reject sends the trimmed reason', async () => {
    const api = mockApi([
      ...ownerRoutes({ permissions: OWNER_PERMS }),
      { path: GET, body: detail() },
      { method: 'POST', path: `${GET}/reject`, body: { booking: ownerBooking({ status: 'rejected' }) } },
    ]);
    const { user } = renderApp(URL_, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.owner.bookings.actions.reject }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), '  fully booked  ');
    await user.click(within(dialog).getByRole('button', { name: en.owner.bookings.reject.confirm }));
    expect(await screen.findByText(en.status.rejected)).toBeTruthy();
    expect(api.calls.find((c) => c.path === `${GET}/reject`)!.body).toEqual({ reason: 'fully booked' });
  });

  it('cancel shows the staff preview and merges refunds', async () => {
    const refund = {
      id: 'r1', paymentId: 'p1', method: 'card', amount: 1000, currency: 'BDT', reason: 'cancellation', ruleApplied: null,
      status: 'pending', failureCode: null, retryOf: null,
    };
    const api = mockApi([
      ...ownerRoutes({ permissions: OWNER_PERMS }),
      {
        method: 'GET',
        path: GET,
        body: (_c: unknown, n: number) =>
          n === 0
            ? detail({ booking: ownerBooking({ status: 'confirmed', amountPaid: 1000, paymentStatus: 'paid' }) })
            : detail({ booking: ownerBooking({ status: 'cancelled', amountPaid: 1000, paymentStatus: 'paid' }), refunds: [refund as never] }),
      },
      {
        path: `${GET}/cancellation`,
        body: { preview: { percent: 100, amount: 1000, rule: null, amountPaid: 1000, amountRefunded: 0, currency: 'BDT', card: 1000, cash: 0 } },
      },
      {
        method: 'POST',
        path: `${GET}/cancel`,
        body: { booking: ownerBooking({ status: 'cancelled', amountPaid: 1000 }), refunds: [refund] },
      },
    ]);
    const { user } = renderApp(URL_, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.owner.bookings.actions.cancel }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/100%/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: en.cancel.confirm }));
    expect(await screen.findByText(en.status.cancelled)).toBeTruthy();
    expect(await screen.findByText(en.cancel.refundsTitle)).toBeTruthy();
    expect(screen.getAllByText(/BDT\s10\.00/).length).toBeGreaterThan(0);
    expect(api.calls.find((c) => c.path === `${GET}/cancel`)!.body).toEqual({});
  });

  it('out-of-scope booking renders not found', async () => {
    mockApi([...ownerRoutes(), { path: GET, status: 404, body: { error: { code: 'not_found', message: 'no' } } }]);
    renderApp(URL_, { user: staffUser });
    expect(await screen.findByText(en.owner.bookings.notFound)).toBeTruthy();
    expect(screen.getByRole('link', { name: en.owner.bookings.back }).getAttribute('href')).toBe(`/owner/${OWNER_ID}/bookings`);
  });
});
