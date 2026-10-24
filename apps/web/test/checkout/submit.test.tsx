import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import { mockApi, type Call } from '../helpers/api';
import { setAccessToken } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import type { BookingJson, PublicUser, PublicVenue, QuoteResponse } from '../../src/lib/types';

const venue: PublicVenue = {
  slug: 'arena-one',
  name: 'Arena One',
  address: 'Road 1',
  city: 'Dhaka',
  country: 'BD',
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
  location: { lat: 1, lng: 2 },
  photos: [],
  amenities: [],
  turfs: [{ id: 't1', name: 'Court A', sports: ['futsal'], indoor: true, slotLengthMin: 60 }],
};
const START = '2026-01-01T12:00:00.000Z';
const PATH = `/venues/arena-one/checkout?turf=t1&date=2026-01-01&slots=${encodeURIComponent(START)}`;
const player: PublicUser = { id: 'u1', name: 'Pat', email: 'p@x.com', emailVerified: true, phone: null, hasPassword: true, hasGoogle: false };

function qr(over: Partial<QuoteResponse> = {}, advance = 0): QuoteResponse {
  return {
    quote: {
      currency: 'BDT',
      slots: [{ startAt: START, endAt: '2026-01-01T13:00:00.000Z', price: 2000 }],
      addons: [],
      subtotal: 2000,
      addonsTotal: 0,
      total: 2000,
      advanceRequired: advance,
    },
    guestAllowed: true,
    guestOtpRequired: false,
    ...over,
  };
}
const booking = (over: Partial<BookingJson> = {}) => ({ id: 'b1', reference: 'AB12CD', status: 'confirmed', ...over }) as BookingJson;

type Extra = { create?: unknown; quoteBody?: unknown; offered?: unknown[] };
function api(quote: QuoteResponse, extra: Extra = {}) {
  return mockApi([
    { path: '/venues/arena-one', body: { venue } },
    { path: '/venues/arena-one/turfs/t1/addons', body: { currency: 'BDT', addons: extra.offered ?? [] } },
    { method: 'POST', path: '/venues/arena-one/turfs/t1/quote', body: extra.quoteBody ?? quote },
    { method: 'POST', path: '/venues/arena-one/bookings/otp', body: { expiresInSec: 300, resendInSec: 60 } },
    {
      method: 'POST',
      path: '/venues/arena-one/turfs/t1/bookings',
      status: 201,
      body: extra.create ?? { booking: booking() },
    },
    { path: '/venues/arena-one/turfs/t1/slots', body: { day: { businessDate: '2026-01-01', currency: 'BDT', status: 'open', slots: [
      { startAt: START, endAt: '2026-01-01T13:00:00.000Z', localStart: '18:00', localEnd: '19:00', price: 2000, status: 'available' },
    ] } } },
  ]);
}
const createCalls = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/t1/bookings'));

beforeEach(() => {
  setAccessToken(null);
  return i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function fillGuest(user: ReturnType<typeof renderApp>['user']) {
  await user.type(await screen.findByLabelText(en.checkout.guestName), 'Ana');
  await user.type(screen.getByLabelText(en.auth.phone.number), '1712345678');
}

describe('placing a booking', () => {
  it('signed-in no-advance booking goes to booking page', async () => {
    const { calls } = api(qr());
    const { user, location } = renderApp(PATH, { user: player });
    await user.click(await screen.findByRole('button', { name: en.checkout.book }));
    await waitFor(() => expect(location().pathname).toBe('/me/bookings/b1'));
    expect(location().search).toBe('?new=1');
    expect(createCalls(calls)[0]!.body).toEqual({ date: '2026-01-01', startAts: [START], addons: [] });
  });

  it('signed-in advance booking goes to pay page', async () => {
    api(qr({}, 1000), { create: { booking: booking({ status: 'awaiting_payment' }) } });
    const { user, location } = renderApp(PATH, { user: player });
    await user.click(await screen.findByRole('button', { name: /Book and pay/ }));
    await waitFor(() => expect(location().pathname).toBe('/me/bookings/b1/pay'));
  });

  it('guest without OTP books and lands on lookup', async () => {
    const { calls } = api(qr());
    const { user, location } = renderApp(PATH);
    await fillGuest(user);
    await user.click(screen.getByRole('button', { name: en.checkout.book }));
    await waitFor(() => expect(location().pathname).toBe('/lookup'));
    expect(location().search).toBe('?reference=AB12CD&phone=%2B8801712345678&new=1');
    expect(createCalls(calls)[0]!.body).toEqual({
      date: '2026-01-01',
      startAts: [START],
      addons: [],
      guest: { name: 'Ana', phone: '+8801712345678' },
    });
  });

  it('guest with OTP sends code then books', async () => {
    const { calls } = api(qr({ guestOtpRequired: true }));
    const { user, location } = renderApp(PATH);
    await fillGuest(user);
    expect(screen.getByRole('button', { name: en.checkout.book })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: en.checkout.sendCode }));
    await user.click(await screen.findByLabelText('Digit 1 of 6'));
    await user.paste('123456');
    await user.click(screen.getByRole('button', { name: en.checkout.book }));
    await waitFor(() => expect(location().pathname).toBe('/lookup'));
    expect(calls.find((c) => c.path.endsWith('/bookings/otp'))!.body).toEqual({ phone: '+8801712345678' });
    expect(createCalls(calls)[0]!.body).toMatchObject({ guest: { name: 'Ana', phone: '+8801712345678', otpCode: '123456' } });
  });

  it('otp_invalid keeps name and phone, clears code', async () => {
    api(qr({ guestOtpRequired: true }), { create: () => ({ status: 400, body: { error: { code: 'otp_invalid', message: 'x' } } }) });
    const { user, location } = renderApp(PATH);
    await fillGuest(user);
    await user.click(screen.getByRole('button', { name: en.checkout.sendCode }));
    await user.click(await screen.findByLabelText('Digit 1 of 6'));
    await user.paste('123456');
    await user.click(screen.getByRole('button', { name: en.checkout.book }));
    expect(await screen.findByText(en.errors.otp_invalid)).toBeInTheDocument();
    expect(location().pathname).toBe('/venues/arena-one/checkout');
    expect(screen.getByLabelText(en.checkout.guestName)).toHaveValue('Ana');
    expect(screen.getByLabelText(en.auth.phone.number)).toHaveValue('1712345678');
    for (let i = 1; i <= 6; i++) expect(screen.getByLabelText(`Digit ${i} of 6`)).toHaveValue('');
  });

  it('slot_taken returns to a refreshed grid', async () => {
    const { calls } = api(qr(), { create: () => ({ status: 409, body: { error: { code: 'slot_taken', message: 'x' } } }) });
    const { user, location } = renderApp(PATH, { user: player });
    await user.click(await screen.findByRole('button', { name: en.checkout.book }));
    expect(await screen.findByText(en.errors.slot_taken)).toBeInTheDocument();
    expect(location().pathname).toBe('/venues/arena-one');
    expect(location().search).toBe('?turf=t1&date=2026-01-01');
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/slots')).length).toBe(1));
    expect(screen.queryByRole('link', { name: en.slots.continue })).not.toBeInTheDocument();
  });

  it('signed-in request carries bearer, guest request does not', async () => {
    const a = api(qr());
    const first = renderApp(PATH, { user: player });
    await first.user.click(await screen.findByRole('button', { name: en.checkout.book }));
    await waitFor(() => expect(createCalls(a.calls).length).toBe(1));
    expect(createCalls(a.calls)[0]!.headers.get('Authorization')).toMatch(/^Bearer /);
    first.unmount();
    setAccessToken(null);
    vi.unstubAllGlobals();

    const b = api(qr());
    const second = renderApp(PATH);
    await fillGuest(second.user);
    await second.user.click(screen.getByRole('button', { name: en.checkout.book }));
    await waitFor(() => expect(createCalls(b.calls).length).toBe(1));
    expect(createCalls(b.calls)[0]!.headers.get('Authorization')).toBeNull();
  });

  it('otp_expired keeps name and phone, clears code', async () => {
    api(qr({ guestOtpRequired: true }), { create: () => ({ status: 400, body: { error: { code: 'otp_expired', message: 'x' } } }) });
    const { user } = renderApp(PATH);
    await fillGuest(user);
    await user.click(screen.getByRole('button', { name: en.checkout.sendCode }));
    await user.click(await screen.findByLabelText('Digit 1 of 6'));
    await user.paste('123456');
    await user.click(screen.getByRole('button', { name: en.checkout.book }));
    expect(await screen.findByText(en.errors.otp_expired)).toBeInTheDocument();
    expect(screen.getByLabelText(en.checkout.guestName)).toHaveValue('Ana');
    expect(screen.getByLabelText(en.auth.phone.number)).toHaveValue('1712345678');
    for (let i = 1; i <= 6; i++) expect(screen.getByLabelText(`Digit ${i} of 6`)).toHaveValue('');
  });

  it('slot_unavailable on submit redirects like slot_taken', async () => {
    api(qr(), { create: () => ({ status: 409, body: { error: { code: 'slot_unavailable', message: 'x' } } }) });
    const { user, location } = renderApp(PATH, { user: player });
    await user.click(await screen.findByRole('button', { name: en.checkout.book }));
    expect(await screen.findByText(en.errors.slot_taken)).toBeInTheDocument();
    expect(location().pathname).toBe('/venues/arena-one');
    expect(location().navType).toBe('REPLACE');
  });

  it('the submit error clears on retry', async () => {
    api(qr(), {
      create: (_c: Call, n: number) =>
        n === 0 ? { status: 500, body: { error: { code: 'internal', message: 'x' } } } : { status: 201, body: { booking: booking() } },
    });
    const { user, location } = renderApp(PATH, { user: player });
    await user.click(await screen.findByRole('button', { name: en.checkout.book }));
    expect(await screen.findByText(en.errors.generic)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.checkout.book }));
    await waitFor(() => expect(location().pathname).toBe('/me/bookings/b1'));
  });

  it('two rapid clicks send one create request', async () => {
    const { calls } = api(qr());
    const { location } = renderApp(PATH, { user: player });
    const btn = await screen.findByRole('button', { name: en.checkout.book });
    await waitFor(() => expect(btn).toBeEnabled());
    act(() => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    await waitFor(() => expect(location().pathname).toBe('/me/bookings/b1'));
    expect(createCalls(calls)).toHaveLength(1);
  });

  it('keeps the guest form filled across an add-on quote error', async () => {
    const shoes = { id: 'a1', name: 'Shoes', pricingType: 'per_unit', unitPrice: 150, maxQuantity: 3, autoApply: null };
    api(qr(), {
      offered: [shoes],
      quoteBody: (_c: Call, n: number) =>
        n === 0 ? qr() : { status: 400, body: { error: { code: 'addon_unavailable', message: 'x' } } },
    });
    const { user } = renderApp(PATH);
    await fillGuest(user);
    await user.click(screen.getByRole('button', { name: 'Increase Shoes' }));
    expect(await screen.findByText(en.errors.addon_unavailable)).toBeInTheDocument();
    expect(screen.getByLabelText(en.checkout.guestName)).toHaveValue('Ana');
    expect(screen.getByLabelText(en.auth.phone.number)).toHaveValue('1712345678');
    expect(screen.getByRole('button', { name: en.checkout.book })).toBeDisabled();
  });
});
