import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { formatMoney } from '@booking/shared';
import { AuthContext, type AuthContextValue } from '../../src/auth/useAuth';
import { ApiError } from '../../src/lib/api';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import PayScreen from '../../app/booking/[id]/pay';

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
const renderPay = () =>
  render(
    <ThemeProvider>
      <AuthContext.Provider value={auth}>
        <PayScreen />
      </AuthContext.Provider>
    </ThemeProvider>,
  );

const money = (n: number) => formatMoney(n, 'BDT', 'en');
const payButton = () => screen.findByRole('button', { name: `Pay ${money(15000)} now` });
const bookingGets = () => mockGet.mock.calls.filter((c) => c[0] === '/me/bookings/b1').length;

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
});
