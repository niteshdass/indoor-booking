import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { PaymentLinkDialog } from '../../src/owner/bookings/PaymentLinkDialog';
import type { BookingDetail, Permission, RefundJson } from '../../src/owner/types';
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

const PERMS: Permission[] = ['booking.view', 'booking.confirm', 'booking.cancel', 'payment.mark_cash'];
const detail = (over: Partial<BookingDetail> = {}): BookingDetail => ({ booking: ownerBooking({ status: 'confirmed', amountPaid: 400 }), payments: [], refunds: [], ...over });
const URL_ = `/owner/${OWNER_ID}/bookings/b1`;
const GET = '/owners/o1/bookings/b1';
const CASH = `${GET}/payments/cash`;
const cashRoute = { method: 'POST', path: CASH, status: 201, body: { booking: ownerBooking({ status: 'confirmed', amountPaid: 1000 }), payment: { id: 'p9' } } };
const refund = (over: Partial<RefundJson>): RefundJson => ({
  id: 'r1', paymentId: 'p1', method: 'card', amount: 400, currency: 'BDT', reason: 'cancellation', ruleApplied: null,
  status: 'failed', failureCode: null, retryOf: null, createdAt: '2026-10-25T01:00:00.000Z', ...over,
});

describe('mark cash', () => {
  it('mark cash defaults to the remaining amount and posts no amount', async () => {
    const api = mockApi([...ownerRoutes({ permissions: PERMS }), { path: GET, body: detail() }, cashRoute]);
    const { user } = renderApp(URL_, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.owner.bookings.actions.markCash }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText(en.owner.cash.amount) as HTMLInputElement).value).toBe('6.00');
    await user.click(within(dialog).getByRole('button', { name: en.owner.cash.confirm }));
    await waitFor(() => expect(api.calls.filter((c) => c.path === CASH)).toHaveLength(1));
    expect(api.calls.find((c) => c.path === CASH)!.body).toEqual({});
  });

  it('mark cash posts a partial amount in minor units', async () => {
    const api = mockApi([...ownerRoutes({ permissions: PERMS }), { path: GET, body: detail() }, cashRoute]);
    const { user } = renderApp(URL_, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.owner.bookings.actions.markCash }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText(en.owner.cash.amount);
    await user.clear(input);
    await user.type(input, '2.50');
    await user.click(within(dialog).getByRole('button', { name: en.owner.cash.confirm }));
    await waitFor(() => expect(api.calls.filter((c) => c.path === CASH)).toHaveLength(1));
    expect(api.calls.find((c) => c.path === CASH)!.body).toEqual({ amount: 250 });
  });

  it('invalid cash amount does not post', async () => {
    const api = mockApi([...ownerRoutes({ permissions: PERMS }), { path: GET, body: detail() }, cashRoute]);
    const { user } = renderApp(URL_, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.owner.bookings.actions.markCash }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText(en.owner.cash.amount);
    for (const bad of ['abc', '0', '6.01', '1.234']) {
      await user.clear(input);
      await user.type(input, bad);
      await user.click(within(dialog).getByRole('button', { name: en.owner.cash.confirm }));
      expect(await within(dialog).findByText(en.owner.cash.invalid)).toBeTruthy();
    }
    expect(api.calls.filter((c) => c.path === CASH)).toHaveLength(0);
  });
});

describe('payment link dialog', () => {
  it('payment link dialog renders a QR svg and copies the url', async () => {
    const user = userEvent.setup();
    const link = { id: 'p1', amount: 1000, currency: 'BDT', url: 'https://pay.example/c/abc' };
    const load = vi.fn(async () => link);
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <PaymentLinkDialog open link={link} load={load} onClose={() => {}} />
      </I18nextProvider>,
    );
    await waitFor(() => expect(container.ownerDocument.querySelector('dialog svg')).toBeTruthy());
    expect((screen.getByLabelText(en.owner.link.url) as HTMLInputElement).value).toBe(link.url);
    expect(screen.getByText(/BDT\s10\.00/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: en.owner.link.copy }));
    expect(await navigator.clipboard.readText()).toBe(link.url);
    expect(await screen.findByText(en.owner.link.copied)).toBeTruthy();
  });

  it('payment link dialog shows a translated error when the hold expired', async () => {
    const { ApiError } = await import('../../src/lib/apiClient');
    const load = vi.fn(async () => {
      throw new ApiError(409, 'hold_expired', 'x');
    });
    render(
      <I18nextProvider i18n={i18n}>
        <PaymentLinkDialog open link={null} load={load} onClose={() => {}} />
      </I18nextProvider>,
    );
    expect(await screen.findByText(en.errors.hold_expired)).toBeTruthy();
  });
});

describe('refund actions', () => {
  const REFUND_PERMS: Permission[] = ['booking.view', 'refund.issue'];
  const dt = (refunds: RefundJson[]) => detail({ booking: ownerBooking({ status: 'cancelled' }), refunds });

  it('failed card refund offers retry and record-cash; pending cash offers record', async () => {
    const api = mockApi([
      ...ownerRoutes({ permissions: REFUND_PERMS }),
      { path: GET, body: dt([refund({ id: 'r1' }), refund({ id: 'r2', method: 'cash', status: 'pending' }), refund({ id: 'r3', status: 'succeeded' })]) },
      { method: 'POST', path: `${GET.replace('/bookings/b1', '')}/refunds/r1/retry`, status: 201, body: { refund: refund({ id: 'r4', status: 'pending' }) } },
      { method: 'POST', path: `/owners/o1/refunds/r2/record-cash`, body: { refund: refund({ id: 'r2', method: 'cash', status: 'succeeded' }) } },
    ]);
    const { user } = renderApp(URL_, { user: staffUser });
    await screen.findByText(en.cancel.refundsTitle);
    expect(screen.getAllByRole('button', { name: en.owner.refunds.retry })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: en.owner.refunds.recordCash })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: en.owner.refunds.recordPaidOut })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: en.owner.refunds.retry }));
    await waitFor(() => expect(api.calls.filter((c) => c.path === '/owners/o1/refunds/r1/retry')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: en.owner.refunds.recordPaidOut }));
    await waitFor(() => expect(api.calls.filter((c) => c.path === '/owners/o1/refunds/r2/record-cash')).toHaveLength(1));
    // Each action reloads the detail.
    await waitFor(() => expect(api.calls.filter((c) => c.method === 'GET' && c.path === GET).length).toBeGreaterThanOrEqual(3));
  });

  it('wallet refund shows where to send and marks it sent', async () => {
    const wallet = refund({ id: 'rw', method: 'wallet', status: 'pending', amount: 250, reason: 'overpayment', trxId: null, provider: 'nagad', sendTo: '+8801812345678' });
    const api = mockApi([
      ...ownerRoutes({ permissions: ['booking.view', 'payment.verify'] }),
      { path: GET, body: dt([wallet]) },
      { method: 'POST', path: '/owners/o1/refunds/rw/mark-sent', body: { refund: { ...wallet, status: 'succeeded', trxId: 'ZX98YW76VU' } } },
    ]);
    const { user } = renderApp(URL_, { user: staffUser });
    expect(await screen.findByText(/Send .*2\.50.* back to \+880 1812-345678 by Nagad/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: en.owner.refunds.markSent }));
    const dialog = await screen.findByRole('dialog', { name: en.owner.refunds.markSentTitle });
    await user.type(within(dialog).getByLabelText(en.owner.refunds.trxId), 'bad');
    await user.click(within(dialog).getByRole('button', { name: en.owner.refunds.markSent }));
    expect(within(dialog).getByText(en.owner.refunds.trxInvalid)).toBeTruthy();
    expect(api.calls.some((c) => c.path.endsWith('/mark-sent'))).toBe(false);
    const field = within(dialog).getByLabelText(en.owner.refunds.trxId);
    await user.clear(field);
    await user.type(field, ' zx98yw76vu ');
    await user.click(within(dialog).getByRole('button', { name: en.owner.refunds.markSent }));
    await waitFor(() => expect(api.calls.find((c) => c.path.endsWith('/mark-sent'))?.body).toEqual({ trxId: 'ZX98YW76VU' }));
  });

  it('mark sent reloads the booking on a 409', async () => {
    const wallet = refund({ id: 'rw', method: 'wallet', status: 'pending', sendTo: '+8801812345678', provider: 'bkash' });
    const api = mockApi([
      ...ownerRoutes({ permissions: ['booking.view', 'payment.verify'] }),
      { path: GET, body: dt([wallet]) },
      { method: 'POST', path: '/owners/o1/refunds/rw/mark-sent', status: 409, body: { error: { code: 'invalid_transition', message: 'x' } } },
    ]);
    const { user } = renderApp(URL_, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.owner.refunds.markSent }));
    const dialog = await screen.findByRole('dialog', { name: en.owner.refunds.markSentTitle });
    await user.type(within(dialog).getByLabelText(en.owner.refunds.trxId), 'ZX98YW76VU');
    await user.click(within(dialog).getByRole('button', { name: en.owner.refunds.markSent }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === 'GET' && c.path === GET)).toHaveLength(2));
  });

  it('wallet refund has no Mark sent without payment.verify', async () => {
    const wallet = refund({ id: 'rw', method: 'wallet', status: 'pending', sendTo: '+8801812345678', provider: 'bkash' });
    mockApi([...ownerRoutes({ permissions: ['booking.view'] }), { path: GET, body: dt([wallet]) }]);
    renderApp(URL_, { user: staffUser });
    await screen.findByText('BK-0001');
    expect(screen.queryByRole('button', { name: en.owner.refunds.markSent })).toBeNull();
  });

  it('refund actions are hidden without refund.issue', async () => {
    mockApi([...ownerRoutes({ permissions: ['booking.view'] }), { path: GET, body: dt([refund({ id: 'r1' }), refund({ id: 'r2', method: 'cash', status: 'pending' })]) }]);
    renderApp(URL_, { user: staffUser });
    await screen.findByText(en.cancel.refundsTitle);
    for (const k of ['retry', 'recordCash', 'recordPaidOut'] as const) {
      expect(screen.queryByRole('button', { name: en.owner.refunds[k] })).toBeNull();
    }
  });
});
