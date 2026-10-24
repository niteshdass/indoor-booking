import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { BookingFacts } from '../../src/bookings/BookingFacts';
import { BookingRow } from '../../src/bookings/BookingRow';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import { mockApi, type Route } from '../helpers/api';
import { setAccessToken } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import type { BookingJson } from '../../src/lib/types';

const PHONE = '+8801712345678';
const URL_OK = `/lookup?reference=AB12CD&phone=${encodeURIComponent(PHONE)}`;

const booking = (over: Partial<BookingJson> = {}) =>
  ({
    id: 'b1',
    reference: 'AB12CD',
    venueId: 'v1',
    turfId: 't1',
    businessDate: '2026-11-03',
    slots: [{ startAt: '2026-11-03T12:00:00.000Z', endAt: '2026-11-03T13:00:00.000Z', price: 1150 }],
    addons: [],
    currency: 'BDT',
    subtotal: 1150,
    addonsTotal: 0,
    total: 1150,
    advanceRequired: 1150,
    amountPaid: 1150,
    amountRefunded: 0,
    status: 'confirmed',
    paymentStatus: 'paid',
    holdExpiresAt: null,
    source: 'online',
    playerId: null,
    guest: { name: 'Gus', phone: PHONE },
    venue: { slug: 'arena-one', name: 'Arena One', address: 'x', city: 'Dhaka', timezone: 'Asia/Dhaka' },
    turf: { name: 'Turf A' },
    ...over,
  }) as BookingJson;

const errBody = (code: string, message = code) => ({ error: { code, message } });

const preview = { percent: 100, amount: 1150, rule: null, amountPaid: 1150, amountRefunded: 0, currency: 'BDT', card: 1150, cash: 0 };

const setup = (over: { booking?: BookingJson; lookup?: Route; cancel?: Route } = {}) =>
  mockApi([
    over.lookup ?? { path: '/bookings/lookup', body: { booking: over.booking ?? booking() } },
    { path: '/bookings/lookup/cancellation', body: { preview } },
    { method: 'POST', path: '/bookings/lookup/otp', body: { sent: true, resendInSec: 60 } },
    over.cancel ?? {
      method: 'POST',
      path: '/bookings/lookup/cancel',
      body: {
        booking: booking({ status: 'cancelled', paymentStatus: 'refunded', amountRefunded: 1150 }),
        refunds: [{ id: 'r1', paymentId: 'p1', method: 'card', amount: 1150, currency: 'BDT', reason: 'cancellation', ruleApplied: null, status: 'pending', failureCode: null, retryOf: null, createdAt: '2026-10-25T00:00:00Z' }],
      },
    },
  ]);

beforeEach(() => {
  setAccessToken(null);
  return i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('guest lookup', () => {
  it('prefilled URL looks up automatically and shows booking', async () => {
    const m = setup();
    renderApp(URL_OK);
    expect(await screen.findByText('Arena One')).toBeInTheDocument();
    expect(screen.getByText('AB12CD')).toBeInTheDocument();
    const call = m.calls.find((c) => c.path === '/bookings/lookup')!;
    expect(call.query.get('reference')).toBe('AB12CD');
    expect(call.query.get('phone')).toBe(PHONE);
  });

  it('typed reference is uppercased and the form writes the URL', async () => {
    const m = setup();
    const { user, location } = renderApp('/lookup');
    const ref = screen.getByLabelText(en.lookup.reference);
    await user.type(ref, 'ab12cd');
    expect(ref).toHaveValue('AB12CD');
    await user.type(screen.getByLabelText(en.auth.phone.number), '1712345678');
    await user.click(screen.getByRole('button', { name: en.lookup.submit }));
    expect(await screen.findByText('Arena One')).toBeInTheDocument();
    expect(m.calls.filter((c) => c.path === '/bookings/lookup')).toHaveLength(1);
    const q = new URLSearchParams(location().search);
    expect(q.get('reference')).toBe('AB12CD');
    expect(q.get('phone')).toBe(PHONE);
    expect(q.get('new')).toBeNull();
  });

  it('not found message is generic', async () => {
    setup({ lookup: { path: '/bookings/lookup', status: 404, body: errBody('not_found') } });
    renderApp(URL_OK);
    expect(await screen.findByText(en.lookup.notFound)).toBeInTheDocument();
  });

  it('other errors show the API message', async () => {
    setup({ lookup: { path: '/bookings/lookup', status: 500, body: errBody('internal', 'Boom') } });
    renderApp(URL_OK);
    expect(await screen.findByText('Boom')).toBeInTheDocument();
  });

  it('new booking shows save-reference note', async () => {
    setup();
    renderApp(`${URL_OK}&new=1`);
    expect(await screen.findByRole('heading', { level: 1, name: en.booking.received })).toBeInTheDocument();
    expect(screen.getByText(en.lookup.saveReference)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.lookup.copyLink })).toBeInTheDocument();
  });

  it('guest cancel needs code', async () => {
    const m = setup();
    const { user } = renderApp(URL_OK);
    await user.click(await screen.findByRole('button', { name: en.cancel.open }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('button', { name: en.checkout.sendCode });
    expect(within(dialog).getByRole('button', { name: en.cancel.confirm })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: en.checkout.sendCode }));
    expect(m.calls.find((c) => c.path === '/bookings/lookup/otp')?.body).toEqual({ reference: 'AB12CD', phone: PHONE });
    const first = await within(dialog).findByLabelText(i18n.t('auth.otp.digit', { n: 1, total: 6 }));
    expect(within(dialog).getByRole('button', { name: en.cancel.confirm })).toBeDisabled();
    await user.click(first);
    await user.keyboard('123456');
    const confirm = within(dialog).getByRole('button', { name: en.cancel.confirm });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(await screen.findByText(en.status.cancelled)).toBeInTheDocument();
    expect(m.calls.find((c) => c.path === '/bookings/lookup/cancel')?.body).toEqual({ reference: 'AB12CD', phone: PHONE, otpCode: '123456' });
    expect(screen.getByText(en.cancel.refundsTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.cancel.open })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('otp_invalid keeps dialog open with message', async () => {
    setup({ cancel: { method: 'POST', path: '/bookings/lookup/cancel', status: 400, body: errBody('otp_invalid') } });
    const { user } = renderApp(URL_OK);
    await user.click(await screen.findByRole('button', { name: en.cancel.open }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: en.checkout.sendCode }));
    await user.click(await within(dialog).findByLabelText(i18n.t('auth.otp.digit', { n: 1, total: 6 })));
    await user.keyboard('000000');
    await user.click(within(dialog).getByRole('button', { name: en.cancel.confirm }));
    expect(await within(dialog).findByText(en.errors.otp_invalid)).toBeInTheDocument();
    expect(dialog).toHaveAttribute('open');
  });

  it('player-linked booking shows sign in to manage', async () => {
    setup({ booking: booking({ playerId: 'u1' }) });
    renderApp(URL_OK);
    expect(await screen.findByText(en.lookup.signInToManage)).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: en.lookup.signIn })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('button', { name: en.cancel.open })).not.toBeInTheDocument();
  });

  it('non-cancellable status shows no cancel button', async () => {
    setup({ booking: booking({ status: 'completed' }) });
    renderApp(URL_OK);
    await screen.findByText('Arena One');
    expect(screen.queryByRole('button', { name: en.cancel.open })).not.toBeInTheDocument();
  });

  it('has ru strings for every new key', () => {
    expect(Object.keys(ru.lookup).sort()).toEqual(Object.keys(en.lookup).sort());
    expect(ru.booking.timesUtc).toBeTruthy();
  });
});

describe('null venue', () => {
  it('BookingFacts renders no empty heading and labels times as UTC; BookingRow too', async () => {
    const b = booking({ venue: null });
    const { unmount } = render(
      <MemoryRouter>
        <BookingFacts booking={b} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.getByText(en.booking.timesUtc, { exact: false })).toBeInTheDocument();
    unmount();
    render(
      <MemoryRouter>
        <BookingRow booking={b} />
      </MemoryRouter>,
    );
    expect(screen.getByText(en.booking.timesUtc, { exact: false })).toBeInTheDocument();
  });
});
