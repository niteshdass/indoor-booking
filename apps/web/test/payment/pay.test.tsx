import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import { mockApi } from '../helpers/api';
import { setAccessToken } from '../../src/lib/apiClient';
import { money } from '../../src/lib/format';
import { renderApp } from '../helpers/render';
import type { BookingJson, PaymentStart, PublicUser } from '../../src/lib/types';

const h = vi.hoisted(() => ({
  loadStripe: vi.fn(),
  confirmPayment: vi.fn(),
  options: [] as unknown[],
}));

vi.mock('@stripe/stripe-js', () => ({ loadStripe: h.loadStripe }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children, options }: { children: ReactNode; options: unknown }) => {
    h.options.push(options);
    return <>{children}</>;
  },
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment: h.confirmPayment }),
  useElements: () => ({}),
}));

const player: PublicUser = { id: 'u1', name: 'Pat', email: 'p@x.com', emailVerified: true, phone: null, hasPassword: true, hasGoogle: false };
const PATH = '/me/bookings/b1/pay';

const booking = (over: Partial<BookingJson> = {}) =>
  ({
    id: 'b1',
    reference: 'AB12CD',
    status: 'awaiting_payment',
    currency: 'BDT',
    venue: { slug: 'arena-one', name: 'Arena One', address: 'x', city: 'Dhaka', timezone: 'Asia/Dhaka' },
    ...over,
  }) as BookingJson;

function start(holdMs = 600_000, key = 'pk_owner'): PaymentStart {
  return {
    payment: { id: 'p1', amount: 1150, currency: 'BDT', gateway: 'stripe', clientSecret: 'cs_1', publishableKey: key },
    holdExpiresAt: new Date(Date.now() + holdMs).toISOString(),
  };
}

function api(opts: { booking?: BookingJson; pay?: unknown; payStatus?: number } = {}) {
  return mockApi([
    { path: '/me/bookings/b1', body: { booking: opts.booking ?? booking(), refunds: [] } },
    { method: 'POST', path: '/bookings/b1/payment', status: opts.payStatus ?? 200, body: opts.pay ?? start() },
  ]);
}

beforeEach(() => {
  setAccessToken(null);
  h.loadStripe.mockReset().mockResolvedValue({});
  h.confirmPayment.mockReset().mockResolvedValue({});
  h.options.length = 0;
  return i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const payButton = () => screen.findByRole('button', { name: en.payment.pay });

describe('pay page', () => {
  it('renders element with client secret and amount', async () => {
    api();
    renderApp(PATH, { user: player });
    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === i18n.t('payment.payNow', { amount: money(1150, 'BDT', 'en') }))).toBeInTheDocument();
    expect((h.options.at(-1) as { clientSecret: string }).clientSecret).toBe('cs_1');
  });

  it("loadStripe called with owner's publishable key", async () => {
    api({ pay: start(600_000, 'pk_owner_b') });
    renderApp(PATH, { user: player });
    await screen.findByTestId('payment-element');
    expect(h.loadStripe).toHaveBeenCalledWith('pk_owner_b');
  });

  it('successful confirm navigates to booking with paid flag', async () => {
    api();
    const { user, location } = renderApp(PATH, { user: player });
    await user.click(await payButton());
    await waitFor(() => expect(location().pathname).toBe('/me/bookings/b1'));
    expect(location().search).toBe('?paid=1');
    expect(h.confirmPayment).toHaveBeenCalledTimes(1);
    expect(h.confirmPayment.mock.calls[0]![0].redirect).toBe('if_required');
  });

  it('card error is shown and form stays', async () => {
    api();
    h.confirmPayment.mockResolvedValue({ error: { message: 'Your card was declined.' } });
    const { user, location } = renderApp(PATH, { user: player });
    await user.click(await payButton());
    expect(await screen.findByText('Your card was declined.')).toBeInTheDocument();
    expect(screen.getByTestId('payment-element')).toBeInTheDocument();
    expect(location().pathname).toBe(PATH);
    expect(await payButton()).toBeEnabled();
  });

  it('expired hold hides the payment form', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api({ pay: start(2000) });
    renderApp(PATH, { user: player });
    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument();
    expect(screen.getByText(en.payment.expired)).toBeInTheDocument();
    expect(h.confirmPayment).not.toHaveBeenCalled();
  });

  it('hold_expired from API shows expired state', async () => {
    api({ payStatus: 409, pay: { error: { code: 'hold_expired', message: 'x' } } });
    renderApp(PATH, { user: player });
    expect(await screen.findByText(en.payment.expired)).toBeInTheDocument();
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.payment.backToVenue })).toHaveAttribute('href', '/venues/arena-one');
  });

  it('already confirmed booking redirects to detail', async () => {
    const { calls } = api({ booking: booking({ status: 'confirmed' }) });
    const { location } = renderApp(PATH, { user: player });
    await waitFor(() => expect(location().pathname).toBe('/me/bookings/b1'));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});
