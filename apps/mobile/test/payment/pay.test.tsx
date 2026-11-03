import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { formatMoney } from '@booking/shared';
import { AuthContext, type AuthContextValue } from '../../src/auth/useAuth';
import { ApiError } from '../../src/lib/api';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import PayScreen from '../../app/booking/[id]/pay';
import { openAuthSessionAsync } from 'expo-web-browser';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'b1' }),
}));

const mockPresent = jest.fn();
jest.mock('@stripe/stripe-react-native', () => ({
  initStripe: jest.fn(async () => undefined),
  initPaymentSheet: jest.fn(async () => ({})),
  presentPaymentSheet: (...a: unknown[]) => mockPresent(...a),
  handleURLCallback: jest.fn(async () => false),
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(async () => ({ type: 'dismiss' })) }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../src/lib/api', () => {
  const actual = jest.requireActual('../../src/lib/api');
  return { ...actual, apiGet: (...a: unknown[]) => mockGet(...a), apiPost: (...a: unknown[]) => mockPost(...a) };
});

const HOUR = 3_600_000;
const T0 = Date.parse('2026-11-05T13:00:00Z');
const NOW = Date.parse('2026-11-05T10:00:00Z');

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  reference: 'BK-1',
  turfId: 't1',
  businessDate: '2026-11-05',
  slots: [{ startAt: new Date(T0).toISOString(), endAt: new Date(T0 + HOUR).toISOString(), price: 150000 }],
  addons: [],
  currency: 'BDT',
  subtotal: 150000,
  addonsTotal: 0,
  coupon: null,
  total: 150000,
  advanceRequired: 15000,
  platformFee: null,
  amountPaid: 0,
  amountRefunded: 0,
  status: 'awaiting_payment',
  paymentStatus: 'unpaid',
  holdExpiresAt: new Date(NOW + 10 * 60_000).toISOString(),
  venue: { slug: 'arena-one', name: 'Arena One', address: 'Road 1', city: 'Dhaka', timezone: 'Asia/Dhaka' },
  turf: { name: 'Court A' },
  manualPayment: null,
  ...over,
});

type Options = { wallets: { provider: string; number: string; accountType: string }[]; card: boolean; sslcommerz: boolean };
const cardOnly: Options = { wallets: [], card: true, sslcommerz: false };
const twoWallets: Options = {
  wallets: [
    { provider: 'bkash', number: '01711111111', accountType: 'personal' },
    { provider: 'nagad', number: '01822222222', accountType: 'personal' },
  ],
  card: true,
  sslcommerz: true,
};
const bkashOnly: Options = { wallets: [{ provider: 'bkash', number: '01711111111', accountType: 'personal' }], card: false, sslcommerz: false };

/** Each GET of the booking takes the next status from `bookings` (the last one repeats). */
function serve(bookings: Record<string, unknown>[], options: Options = cardOnly) {
  let i = 0;
  mockGet.mockImplementation(async (path: string) => {
    if (path === '/me/bookings/b1') {
      const b = bookings[Math.min(i++, bookings.length - 1)]!;
      return { booking: b, refunds: [], group: null };
    }
    if (path === '/bookings/b1/payment-options') return { ...options, amount: 15000, currency: 'BDT', holdExpiresAt: booking().holdExpiresAt };
    throw new Error(`unexpected GET ${path}`);
  });
}

const user = { id: 'u1', name: 'Asha', email: 'a@b.c', emailVerified: true, phone: '+8801712345678', hasPassword: true, hasGoogle: false, platformAdmin: false };
const auth: AuthContextValue = { status: 'signedIn', user, signIn: jest.fn(), setUser: jest.fn(), signOut: jest.fn(), retry: jest.fn() };
const payTree = (value: Partial<AuthContextValue> = {}) => (
  <ThemeProvider>
    <AuthContext.Provider value={{ ...auth, ...value }}>
      <PayScreen />
    </AuthContext.Provider>
  </ThemeProvider>
);
const renderPay = (value: Partial<AuthContextValue> = {}) => render(payTree(value));
const stripeStart = {
  payment: { id: 'p1', amount: 15000, currency: 'BDT', gateway: 'stripe', clientSecret: 'pi_1_secret_x', publishableKey: 'pk_test_1' },
  holdExpiresAt: booking().holdExpiresAt,
};

const money = (n: number) => formatMoney(n, 'BDT', 'en');
const payButton = () => screen.findByRole('button', { name: `Pay ${money(15000)} now` });
const bookingGets = () => mockGet.mock.calls.filter((c) => c[0] === '/me/bookings/b1').length;

/** Moves the clock in poll-sized steps, letting each refetch settle before the next one is scheduled. */
async function advance(ms: number) {
  for (let left = ms; left > 0; left -= 2000) {
    await act(async () => {
      jest.advanceTimersByTime(Math.min(2000, left));
    });
  }
}

let appStateListeners: ((s: AppStateStatus) => void)[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, fn) => {
    if (type === 'change') appStateListeners.push(fn as (s: AppStateStatus) => void);
    return { remove: () => (appStateListeners = appStateListeners.filter((x) => x !== fn)) } as ReturnType<typeof AppState.addEventListener>;
  });
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(new Date(NOW));
});
afterEach(() => jest.useRealTimers());

describe('pay screen', () => {
  it('hold expired (409 or status expired) shows "hold expired, pick again" with a button back to the venue', async () => {
    serve([booking()]);
    mockPost.mockRejectedValue(new ApiError(409, 'hold_expired', 'expired'));
    const view = await renderPay();
    await fireEvent.press(await payButton());
    expect(await screen.findByText(/hold expired/i)).toBeTruthy();
    expect(screen.getByText(/pick your slots again/i)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to venue' }));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/venue/[slug]', params: { slug: 'arena-one' } });
    await view.unmount();

    jest.clearAllMocks();
    serve([booking({ status: 'expired' })]);
    await renderPay();
    expect(await screen.findByText(/hold expired/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to venue' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Pay / })).toBeNull();
  });

  it('returning to foreground refetches the booking and shows confirmed', async () => {
    serve([booking(), booking({ status: 'confirmed', paymentStatus: 'partially_paid', amountPaid: 15000 })]);
    await renderPay();
    await payButton();
    expect(bookingGets()).toBe(1);

    await act(async () => {
      appStateListeners.forEach((fn) => fn('background'));
      appStateListeners.forEach((fn) => fn('active'));
    });

    expect(await screen.findByText('Confirmed')).toBeTruthy();
    expect(bookingGets()).toBe(2);
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/booking/[id]', params: { id: 'b1' } });
  });

  it('Stripe cancel leaves the booking awaiting_payment with a Pay button', async () => {
    serve([booking()]);
    mockPost.mockResolvedValue({
      payment: { id: 'p1', amount: 15000, currency: 'BDT', gateway: 'stripe', clientSecret: 'pi_1_secret_x', publishableKey: 'pk_test_1' },
      holdExpiresAt: booking().holdExpiresAt,
    });
    mockPresent.mockResolvedValue({ error: { code: 'Canceled', message: 'The payment flow has been canceled' } });
    await renderPay();
    await fireEvent.press(await payButton());

    expect(await screen.findByText('Payment cancelled.')).toBeTruthy();
    expect(mockPost).toHaveBeenCalledWith('/bookings/b1/payment', { gateway: 'stripe' });
    expect(mockPresent).toHaveBeenCalledTimes(1);
    expect(bookingGets()).toBe(2);
    expect(await payButton()).not.toBeDisabled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('manual wallet submit shows "waiting for venue to verify"', async () => {
    const sent = { provider: 'bkash', trxId: 'ABCD1234EF', amount: 15000, status: 'pending', submittedAt: new Date(NOW).toISOString() };
    serve([booking(), booking({ status: 'pending', manualPayment: sent })], bkashOnly);
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/bookings/b1/payments/manual') return { booking: booking({ status: 'pending', manualPayment: sent }), outcome: 'pending' };
      throw new Error(`unexpected POST ${path}`);
    });
    await renderPay();

    await fireEvent.changeText(await screen.findByLabelText('Transaction ID'), 'abcd1234ef');
    await fireEvent.changeText(screen.getByLabelText('Sent from'), '01712345678');
    await fireEvent.press(screen.getByRole('button', { name: 'I have sent the money' }));

    expect(await screen.findByText(/waiting for the venue to verify/i)).toBeTruthy();
    expect(mockPost).toHaveBeenCalledWith('/bookings/b1/payments/manual', { provider: 'bkash', trxId: 'ABCD1234EF', senderNumber: '01712345678' });
  });

  it('the clock running out keeps the chosen wallet and the typed Transaction ID, and submits under that wallet', async () => {
    const sent = { provider: 'nagad', trxId: 'NAGAD12345', amount: 15000, status: 'pending', submittedAt: new Date(NOW).toISOString() };
    serve([booking(), booking({ status: 'pending', manualPayment: sent })], twoWallets);
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/bookings/b1/payments/manual') return { booking: booking({ status: 'pending', manualPayment: sent }), outcome: 'pending' };
      throw new Error(`unexpected POST ${path}`);
    });
    await renderPay();
    await fireEvent.press(await screen.findByRole('tab', { name: 'Nagad' }));
    await fireEvent.changeText(screen.getByLabelText('Transaction ID'), 'nagad12345');

    await act(async () => {
      jest.advanceTimersByTime(11 * 60_000);
    });
    expect(await screen.findByText(/hold expired/i)).toBeTruthy();
    // Card and online checkout are gone once the hold ends; the wallets stay, on the one the player picked.
    expect(screen.queryByRole('tab', { name: 'Card' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Nagad' })).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
    expect(screen.getByLabelText('Transaction ID')).toHaveProp('value', 'nagad12345');

    await fireEvent.changeText(screen.getByLabelText('Sent from'), '01712345678');
    await fireEvent.press(screen.getByRole('button', { name: 'I have sent the money' }));
    expect(await screen.findByText(/waiting for the venue to verify/i)).toBeTruthy();
    expect(mockPost).toHaveBeenCalledWith('/bookings/b1/payments/manual', { provider: 'nagad', trxId: 'NAGAD12345', senderNumber: '01712345678' });
  });

  it('a late wallet submission whose slots were taken says so, with the Transaction ID, instead of "pick again"', async () => {
    const sent = { provider: 'nagad', trxId: 'NAGAD12345', amount: 15000, status: 'pending', submittedAt: new Date(NOW).toISOString() };
    const late = booking({ status: 'expired', manualPayment: sent });
    serve([booking({ status: 'expired' }), late], twoWallets);
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/bookings/b1/payments/manual') return { booking: late, outcome: 'slots_taken' };
      throw new Error(`unexpected POST ${path}`);
    });
    await renderPay();
    await fireEvent.press(await screen.findByRole('tab', { name: 'Nagad' }));
    await fireEvent.changeText(screen.getByLabelText('Transaction ID'), 'nagad12345');
    await fireEvent.changeText(screen.getByLabelText('Sent from'), '01712345678');
    await fireEvent.press(screen.getByRole('button', { name: 'I have sent the money' }));

    expect(await screen.findByText('These times were taken while you paid. The venue will send your money back once they check it.')).toBeTruthy();
    expect(screen.getByText(/Nagad · NAGAD12345/)).toBeTruthy();
    expect(screen.queryByText(/hold expired/i)).toBeNull();
    expect(screen.queryByLabelText('Transaction ID')).toBeNull();
    expect(mockPost).toHaveBeenCalledWith('/bookings/b1/payments/manual', { provider: 'nagad', trxId: 'NAGAD12345', senderNumber: '01712345678' });
  });

  it('the wallet form recovers when the refetch after a submit fails', async () => {
    const sent = { provider: 'bkash', trxId: 'ABCD1234EF', amount: 15000, status: 'pending', submittedAt: new Date(NOW).toISOString() };
    let gets = 0;
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/me/bookings/b1') {
        if (++gets > 1) throw new ApiError(0, 'network_error', 'offline');
        return { booking: booking(), refunds: [], group: null };
      }
      return { ...bkashOnly, amount: 15000, currency: 'BDT', holdExpiresAt: booking().holdExpiresAt };
    });
    mockPost.mockResolvedValue({ booking: booking({ status: 'pending', manualPayment: sent }), outcome: 'pending' });
    await renderPay();
    await fireEvent.changeText(await screen.findByLabelText('Transaction ID'), 'abcd1234ef');
    await fireEvent.changeText(screen.getByLabelText('Sent from'), '01712345678');
    await fireEvent.press(screen.getByRole('button', { name: 'I have sent the money' }));
    // The booking from the submit response is shown even though the refetch failed.
    expect(await screen.findByText(/waiting for the venue to verify/i)).toBeTruthy();
  });

  it('the hold running out while the Stripe sheet is open shows the expired panel, not an error', async () => {
    serve([booking()]);
    mockPost.mockResolvedValue({
      payment: { id: 'p1', amount: 15000, currency: 'BDT', gateway: 'stripe', clientSecret: 'pi_1_secret_x', publishableKey: 'pk_test_1' },
      holdExpiresAt: booking().holdExpiresAt,
    });
    mockPresent.mockImplementation(async () => {
      jest.setSystemTime(new Date(NOW + 11 * 60_000));
      return { error: { code: 'Failed', message: 'Your card was declined' } };
    });
    await renderPay();
    await fireEvent.press(await payButton());
    expect(await screen.findByText(/hold expired/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to venue' })).toBeTruthy();
    expect(screen.queryByText('Your card was declined')).toBeNull();
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  it('dismissing SSLCommerz while the booking is still awaiting payment shows "checking" and polls until it is confirmed', async () => {
    serve([booking(), booking(), booking(), booking({ status: 'confirmed' })], { wallets: [], card: false, sslcommerz: true });
    mockPost.mockResolvedValue({ payment: { id: 'p1', amount: 15000, currency: 'BDT', gateway: 'sslcommerz', url: 'https://sandbox.example/pay' }, holdExpiresAt: null });
    await renderPay();
    await fireEvent.press(await screen.findByRole('button', { name: 'Continue to payment' }));
    expect(openAuthSessionAsync).toHaveBeenCalledWith('https://sandbox.example/pay', 'bookaturf://payment-return');
    expect(await screen.findByText('Payment sent. Updating your booking…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue to payment' })).toBeNull();
    expect(screen.queryByText('Awaiting payment')).toBeNull();
    expect(bookingGets()).toBe(2);
    // Every two seconds until the webhook has landed.
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(bookingGets()).toBe(3);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(await screen.findByText('Confirmed')).toBeTruthy();
    expect(bookingGets()).toBe(4);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/booking/[id]', params: { id: 'b1' } });
  });

  it('an SSLCommerz checkout still unknown after the poll budget offers paying again', async () => {
    serve([booking()], { wallets: [], card: false, sslcommerz: true });
    mockPost.mockResolvedValue({ payment: { id: 'p1', amount: 15000, currency: 'BDT', gateway: 'sslcommerz', url: 'https://sandbox.example/pay' }, holdExpiresAt: null });
    await renderPay();
    await fireEvent.press(await screen.findByRole('button', { name: 'Continue to payment' }));
    expect(await screen.findByText('Payment sent. Updating your booking…')).toBeTruthy();
    await advance(60_000);
    expect(await screen.findByRole('button', { name: 'Continue to payment' })).toBeTruthy();
    expect(screen.queryByText('Payment sent. Updating your booking…')).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    // The poll stopped with the budget.
    const gets = bookingGets();
    await advance(10_000);
    expect(bookingGets()).toBe(gets);
  });

  it('a completed card payment waits on the pay screen and polls until the booking is confirmed', async () => {
    serve([booking(), booking(), booking({ status: 'confirmed', paymentStatus: 'partially_paid', amountPaid: 15000 })]);
    mockPost.mockResolvedValue(stripeStart);
    mockPresent.mockResolvedValue({});
    await renderPay();
    await fireEvent.press(await payButton());

    // The first look after the sheet still says awaiting payment: stay here, say so, no Pay button.
    expect(await screen.findByText('Confirming payment…')).toBeTruthy();
    expect(bookingGets()).toBe(2);
    expect(screen.queryByRole('button', { name: /^Pay / })).toBeNull();
    expect(screen.queryByText('Awaiting payment')).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(bookingGets()).toBe(3);
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/booking/[id]', params: { id: 'b1' } });
  });

  it('a completed card payment still unconfirmed after 60 s goes to the booking marked as confirming', async () => {
    serve([booking()]);
    mockPost.mockResolvedValue(stripeStart);
    mockPresent.mockResolvedValue({});
    await renderPay();
    await fireEvent.press(await payButton());
    expect(await screen.findByText('Confirming payment…')).toBeTruthy();

    await advance(58_000);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(bookingGets()).toBeGreaterThanOrEqual(30);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/booking/[id]', params: { id: 'b1', confirming: '1' } });
  });

  it('leaving the pay screen while confirming stops the poll', async () => {
    serve([booking()]);
    mockPost.mockResolvedValue(stripeStart);
    mockPresent.mockResolvedValue({});
    const view = await renderPay();
    await fireEvent.press(await payButton());
    expect(await screen.findByText('Confirming payment…')).toBeTruthy();
    await view.unmount();
    const gets = bookingGets();
    await advance(120_000);
    expect(bookingGets()).toBe(gets);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('signed out opens sign-in once, then offers "Sign in to pay" instead of a spinner', async () => {
    serve([booking()]);
    await renderPay({ status: 'signedOut', user: null });
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-in?next=%2Fbooking%2Fb1%2Fpay');
    expect(screen.queryByLabelText('Loading')).toBeNull();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign in to pay' }));
    expect(mockRouter.push).toHaveBeenCalledTimes(2);
    expect(mockRouter.push).toHaveBeenLastCalledWith('/sign-in?next=%2Fbooking%2Fb1%2Fpay');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('has a visible Back control', async () => {
    serve([booking()]);
    await renderPay();
    await payButton();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockRouter.back.mock.calls.length + mockRouter.replace.mock.calls.length).toBe(1);
  });
});
