import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
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

const player: PublicUser = { id: 'u1', name: 'Pat', email: 'p@x.com', emailVerified: true, phone: null, hasPassword: true, hasGoogle: false, platformAdmin: false };
const PATH = '/me/bookings/b1/pay';

const booking = (over: Partial<BookingJson> = {}) =>
  ({
    id: 'b1',
    reference: 'AB12CD',
    status: 'awaiting_payment',
    currency: 'BDT',
    businessDate: '2026-11-03',
    slots: [],
    addons: [],
    venue: { slug: 'arena-one', name: 'Arena One', address: 'x', city: 'Dhaka', timezone: 'Asia/Dhaka' },
    ...over,
  }) as BookingJson;

function start(holdMs = 600_000, key = 'pk_owner'): PaymentStart {
  return {
    payment: { id: 'p1', amount: 1150, currency: 'BDT', gateway: 'stripe', clientSecret: 'cs_1', publishableKey: key },
    holdExpiresAt: new Date(Date.now() + holdMs).toISOString(),
  };
}

type Options = { wallets: unknown[]; card: boolean; amount: number; currency: string; holdExpiresAt: string | null };
const BKASH = { provider: 'bkash', number: '+8801712345678', accountType: 'personal', note: 'Pay before 9pm' };

function options(over: Partial<Options> = {}, pay?: unknown): Options {
  const hold = (pay as PaymentStart | undefined)?.holdExpiresAt ?? new Date(Date.now() + 600_000).toISOString();
  return { wallets: [], card: true, amount: 1150, currency: 'BDT', holdExpiresAt: hold, ...over };
}

function api(opts: { booking?: BookingJson; pay?: unknown; payStatus?: number; options?: Partial<Options>; manual?: unknown } = {}) {
  return mockApi([
    { path: '/me/bookings/b1', body: { booking: opts.booking ?? booking(), refunds: [] } },
    { path: '/bookings/b1/payment-options', body: options(opts.options, opts.pay) },
    { method: 'POST', path: '/bookings/b1/payments/manual', status: (opts.manual as { status?: number } | undefined)?.status ?? 201, body: (opts.manual as { body?: unknown } | undefined)?.body ?? { booking: booking(), outcome: 'pending' } },
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

describe('pay page edge cases', () => {
  it('hold expiring during a pending confirm that succeeds still navigates paid', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api({ pay: start(2000, 'pk_edge1') });
    let resolve!: (v: unknown) => void;
    h.confirmPayment.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user, location } = renderApp(PATH, { user: player });
    await user.click(await payButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByText(en.payment.expired)).not.toBeInTheDocument();
    expect(screen.getByTestId('payment-element')).toBeInTheDocument();
    await act(async () => resolve({}));
    await waitFor(() => expect(location().search).toBe('?paid=1'));
    expect(screen.queryByText(en.payment.expired)).not.toBeInTheDocument();
  });

  it('confirm error after expiry shows expired', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api({ pay: start(2000, 'pk_edge2') });
    let resolve!: (v: unknown) => void;
    h.confirmPayment.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = renderApp(PATH, { user: player });
    await user.click(await payButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await act(async () => resolve({ error: { message: 'declined' } }));
    expect(await screen.findByText(en.payment.expired)).toBeInTheDocument();
  });

  it('double click confirms once', async () => {
    api({ pay: start(600_000, 'pk_edge3') });
    h.confirmPayment.mockReturnValue(new Promise(() => {}));
    const { user } = renderApp(PATH, { user: player });
    const btn = await payButton();
    await user.dblClick(btn);
    expect(h.confirmPayment).toHaveBeenCalledTimes(1);
  });

  it('payments_unavailable shows alert and retry re-posts', async () => {
    const { calls } = api({ payStatus: 409, pay: { error: { code: 'payments_unavailable', message: 'x' } } });
    const { user } = renderApp(PATH, { user: player });
    expect(await screen.findByText(en.errors.payments_unavailable)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.search.retry }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2));
  });

  it('loadStripe rejection shows alert and retry recovers', async () => {
    api({ pay: start(600_000, 'pk_edge5') });
    h.loadStripe.mockRejectedValueOnce(new Error('net'));
    const { user } = renderApp(PATH, { user: player });
    expect(await screen.findByText(en.payment.loadFailed)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.search.retry }));
    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
    expect(h.loadStripe).toHaveBeenCalledTimes(2);
  });
});

describe('pay by wallet', () => {
  const both = { wallets: [BKASH], card: true };
  const trxField = () => screen.findByLabelText(en.payment.wallet.trxId);

  it('wallet tab shows the amount and number and submits the TrxID', async () => {
    const { calls } = api({ options: both });
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { user, location } = renderApp(PATH, { user: player });
    await trxField();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === i18n.t('payment.wallet.send', { amount: money(1150, 'BDT', 'en') }))).toBeInTheDocument();
    expect(screen.getAllByText('+880 1712-345678', { selector: 'span' })[0]).toBeInTheDocument();
    expect(screen.getByText('Pay before 9pm')).toBeInTheDocument();
    expect(screen.getByText(/Open bKash → Send Money → .* → copy the Transaction ID/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.payment.wallet.copy }));
    expect(writeText).toHaveBeenCalledWith('+8801712345678');
    expect(await screen.findByText(en.payment.wallet.copied)).toBeInTheDocument();
    await user.type(await trxField(), '9a1b2c3d4e');
    await user.type(screen.getByLabelText(en.payment.wallet.sender), '01812345678');
    await user.click(screen.getByRole('button', { name: en.payment.wallet.submit }));
    await waitFor(() => expect(location().pathname).toBe('/me/bookings/b1'));
    expect(location().search).toBe('?submitted=1');
    const post = calls.find((c) => c.path === '/bookings/b1/payments/manual')!;
    expect(post.body).toEqual({ provider: 'bkash', trxId: '9A1B2C3D4E', senderNumber: '01812345678' });
  });

  it('the number in the steps is its own span so it never breaks across lines', async () => {
    api({ options: both });
    renderApp(PATH, { user: player });
    await trxField();
    const spans = screen.getAllByText('+880 1712-345678', { selector: 'span' });
    expect(spans).toHaveLength(2);
    expect(spans[1]!.closest('p')!.textContent).toMatch(/Open bKash → Send Money → \+880 1712-345678 → .* → copy the Transaction ID/);
  });

  it('agent and merchant numbers change the step wording', async () => {
    api({ options: { wallets: [{ ...BKASH, accountType: 'agent' }], card: false } });
    renderApp(PATH, { user: player });
    expect(await screen.findByText(/Open bKash → Cash Out → /)).toBeInTheDocument();
  });

  it('a late submit adds late=1', async () => {
    api({ options: both, manual: { body: { booking: booking(), outcome: 'slots_taken' } } });
    const { user, location } = renderApp(PATH, { user: player });
    await user.type(await trxField(), '9A1B2C3D4E');
    await user.type(screen.getByLabelText(en.payment.wallet.sender), '01812345678');
    await user.click(screen.getByRole('button', { name: en.payment.wallet.submit }));
    await waitFor(() => expect(location().search).toBe('?submitted=1&late=1'));
  });

  it('invalid TrxID is flagged before submit', async () => {
    const { calls } = api({ options: both });
    const { user } = renderApp(PATH, { user: player });
    await user.type(await trxField(), 'abc');
    await user.type(screen.getByLabelText(en.payment.wallet.sender), '01812345678');
    await user.click(screen.getByRole('button', { name: en.payment.wallet.submit }));
    expect(await trxField()).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('trx_id_used error shows next to the Transaction ID field', async () => {
    api({ options: both, manual: { status: 409, body: { error: { code: 'trx_id_used', message: 'x' } } } });
    const { user, location } = renderApp(PATH, { user: player });
    await user.type(await trxField(), '9A1B2C3D4E');
    await user.type(screen.getByLabelText(en.payment.wallet.sender), '01812345678');
    await user.click(screen.getByRole('button', { name: en.payment.wallet.submit }));
    const field = await trxField();
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    const described = field.getAttribute('aria-describedby')!.split(' ').map((i) => document.getElementById(i)?.textContent);
    expect(described).toContain(en.errors.trx_id_used);
    expect(location().pathname).toBe(PATH);
  });

  it('card tab starts the Stripe intent only when chosen', async () => {
    // With wallets on offer the first wallet opens, so no card intent is started until Card is chosen.
    const { calls } = api({ options: { wallets: [BKASH], card: true } });
    const { user } = renderApp(PATH, { user: player });
    await trxField();
    expect(calls.some((c) => c.path === '/bookings/b1/payment')).toBe(false);
    await user.click(screen.getByRole('tab', { name: en.payment.wallet.card }));
    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/bookings/b1/payment')).toHaveLength(1);
  });

  it('card-only venue opens on card with no tabs', async () => {
    api();
    renderApp(PATH, { user: player });
    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('hold ending keeps the wallet form and the typed TrxID, and a revived submit goes through', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hold = new Date(Date.now() + 2000).toISOString();
    const { calls } = api({ options: { ...both, holdExpiresAt: hold } });
    const { user, location } = renderApp(PATH, { user: player });
    await user.type(await trxField(), '9A1B2C3D4E');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByText(en.payment.expired)).not.toBeInTheDocument();
    expect(screen.getByText(en.payment.wallet.holdEnded)).toBeInTheDocument();
    expect(await trxField()).toHaveValue('9A1B2C3D4E');
    await user.type(screen.getByLabelText(en.payment.wallet.sender), '01812345678');
    const submit = screen.getByRole('button', { name: en.payment.wallet.submit });
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(location().search).toBe('?submitted=1'));
    expect(calls.filter((c) => c.path === '/bookings/b1/payments/manual')).toHaveLength(1);
  });

  it('a submit after the hold ended whose times were taken adds late=1', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hold = new Date(Date.now() + 2000).toISOString();
    api({ options: { ...both, holdExpiresAt: hold }, manual: { body: { booking: booking({ status: 'expired' }), outcome: 'slots_taken' } } });
    const { user, location } = renderApp(PATH, { user: player });
    await trxField();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await user.type(await trxField(), '9A1B2C3D4E');
    await user.type(screen.getByLabelText(en.payment.wallet.sender), '01812345678');
    await user.click(screen.getByRole('button', { name: en.payment.wallet.submit }));
    await waitFor(() => expect(location().search).toBe('?submitted=1&late=1'));
  });

  it('after the hold ended the Card tab alone shows Expired', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hold = new Date(Date.now() + 2000).toISOString();
    const { calls } = api({ options: { ...both, holdExpiresAt: hold } });
    const { user } = renderApp(PATH, { user: player });
    await trxField();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await user.click(screen.getByRole('tab', { name: en.payment.wallet.card }));
    expect(await screen.findByText(en.payment.expired)).toBeInTheDocument();
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument();
    expect(calls.some((c) => c.path === '/bookings/b1/payment')).toBe(false);
    await user.click(screen.getByRole('tab', { name: 'bKash' }));
    expect(await trxField()).toBeInTheDocument();
  });

  it('an expired booking with no wallet payment yet opens the wallet form', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    api({ booking: booking({ status: 'expired', holdExpiresAt: past, manualPayment: null }), options: { ...both, holdExpiresAt: past } });
    const { location } = renderApp(PATH, { user: player });
    expect(await trxField()).toBeInTheDocument();
    expect(screen.getByText(en.payment.wallet.holdEnded)).toBeInTheDocument();
    expect(location().pathname).toBe(PATH);
  });

  it('an expired booking at a card-only venue shows Expired', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { calls } = api({ booking: booking({ status: 'expired', holdExpiresAt: past }), options: { holdExpiresAt: past } });
    renderApp(PATH, { user: player });
    expect(await screen.findByText(en.payment.expired)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('an expired booking that already has a wallet payment goes back to the booking', async () => {
    const manualPayment = { provider: 'bkash', trxId: '9A1B2C3D4E', amount: 1150, status: 'pending', submittedAt: new Date().toISOString() } as const;
    api({ booking: booking({ status: 'expired', manualPayment }), options: both });
    const { location } = renderApp(PATH, { user: player });
    await waitFor(() => expect(location().pathname).toBe('/me/bookings/b1'));
  });

  it('ru strings exist for every new key', () => {
    const keys = (o: Record<string, unknown>, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(ru.payment.wallet).sort()).toEqual(keys(en.payment.wallet).sort());
    expect(Object.keys(en.payment.wallet).length).toBeGreaterThan(5);
  });
});
