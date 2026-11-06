import { useEffect as mockUseEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { formatMoney } from '@booking/shared';
import { AuthContext, type AuthContextValue } from '../../src/auth/useAuth';
import { ApiError } from '../../src/lib/api';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import BookingsScreen from '../../app/(tabs)/bookings';
import BookingDetailScreen from '../../app/booking/[id]/index';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = { id: 'b1' };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => mockUseEffect(cb, [cb]),
}));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../src/lib/api', () => {
  const actual = jest.requireActual('../../src/lib/api');
  return { ...actual, apiGet: (...a: unknown[]) => mockGet(...a), apiPost: (...a: unknown[]) => mockPost(...a) };
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-05T10:00:00Z');
const T0 = Date.parse('2026-11-05T13:00:00Z'); // 19:00 in Dhaka (UTC+6); the test process runs as UTC

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
  total: 150000,
  advanceRequired: 15000,
  platformFee: null,
  amountPaid: 15000,
  amountRefunded: 0,
  status: 'confirmed',
  paymentStatus: 'partially_paid',
  holdExpiresAt: null,
  venue: { slug: 'arena-one', name: 'Arena One', address: 'Road 1', city: 'Dhaka', timezone: 'Asia/Dhaka' },
  turf: { name: 'Court A' },
  manualPayment: null,
  ...over,
});
const past = (id: string, over: Record<string, unknown> = {}) =>
  booking({
    id,
    reference: `BK-${id}`,
    businessDate: '2026-11-02',
    slots: [{ startAt: new Date(T0 - 3 * DAY).toISOString(), endAt: new Date(T0 - 3 * DAY + HOUR).toISOString(), price: 150000 }],
    status: 'completed',
    turf: { name: 'Court Z' },
    ...over,
  });

const user = { id: 'u1', name: 'Asha', email: 'a@b.c', emailVerified: true, phone: '+8801712345678', hasPassword: true, hasGoogle: false, platformAdmin: false };
const auth: AuthContextValue = { status: 'signedIn', user, signIn: jest.fn(), setUser: jest.fn(), signOut: jest.fn(), retry: jest.fn() };
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const wrap = (node: React.ReactNode, value: Partial<AuthContextValue> = {}) => (
  <SafeAreaProvider initialMetrics={metrics}>
    <ThemeProvider>
      <AuthContext.Provider value={{ ...auth, ...value }}>{node}</AuthContext.Provider>
    </ThemeProvider>
  </SafeAreaProvider>
);

const preview = (over: Record<string, unknown> = {}) => ({
  percent: 50,
  amount: 7500,
  rule: { minHoursBefore: 24, percent: 50 },
  amountPaid: 15000,
  amountRefunded: 0,
  currency: 'BDT',
  card: 7500,
  wallet: 0,
  cash: 0,
  ...over,
});

function serveDetail(b: Record<string, unknown> = booking(), venueLocation: unknown = { lat: 23.8, lng: 90.4 }) {
  mockGet.mockImplementation(async (path: string) => {
    if (path === '/me/bookings/b1') return { booking: b, refunds: [], group: [] };
    if (path === '/me/bookings/b1/cancellation') return { preview: preview() };
    if (path === '/venues/arena-one') return { venue: { slug: 'arena-one', location: venueLocation } };
    throw new Error(`unexpected GET ${path}`);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 'b1' };
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(new Date(NOW));
});
afterEach(() => jest.useRealTimers());

describe('my bookings', () => {
  it('upcoming and past tabs list the right bookings', async () => {
    mockGet.mockResolvedValue({
      bookings: [
        booking(),
        booking({ id: 'b2', reference: 'BK-2', status: 'cancelled', turf: { name: 'Court C' } }),
        past('b3'),
        past('b4', { status: 'confirmed', turf: { name: 'Court Y' } }),
      ],
    });
    await render(wrap(<BookingsScreen />));
    expect(mockGet).toHaveBeenCalledWith('/me/bookings');

    // Upcoming: only the live future one, with venue-local time (19:00, not the device's 13:00).
    expect(await screen.findByText(/Court A/)).toBeTruthy();
    expect(screen.getByText(/19:00/)).toBeTruthy();
    expect(screen.queryByText(/13:00/)).toBeNull();
    expect(screen.getByText('Confirmed')).toBeTruthy();
    expect(screen.queryByText(/Court C/)).toBeNull();
    expect(screen.queryByText(/Court Z/)).toBeNull();

    await fireEvent.press(screen.getByRole('tab', { name: 'Past' }));
    expect(screen.getByText(/Court Z/)).toBeTruthy();
    expect(screen.getByText(/Court C/)).toBeTruthy();
    expect(screen.getByText(/Court Y/)).toBeTruthy();
    expect(screen.queryByText(/Court A/)).toBeNull();
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.getByText('Cancelled')).toBeTruthy();

    await fireEvent.press(screen.getByText(/Court Z/));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/booking/[id]', params: { id: 'b3' } });
  });

  it('signed out shows the sign-in prompt, not an error', async () => {
    await render(wrap(<BookingsScreen />, { status: 'signedOut', user: null }));
    expect(await screen.findByText('Sign in to see your bookings.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-in?next=%2Fbookings');
  });

  it('signing out drops the list, and the next account never sees the old one', async () => {
    mockGet.mockResolvedValueOnce({ bookings: [booking()] });
    const view = await render(wrap(<BookingsScreen />));
    expect(await screen.findByText(/Court A/)).toBeTruthy();

    await view.rerender(wrap(<BookingsScreen />, { status: 'signedOut', user: null }));
    expect(await screen.findByText('Sign in to see your bookings.')).toBeTruthy();
    expect(screen.queryByText(/Court A/)).toBeNull();

    // Another player signs in; their list is still on its way.
    let resolve!: (v: unknown) => void;
    mockGet.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await view.rerender(wrap(<BookingsScreen />, { user: { ...user, id: 'u2', name: 'Bilal' } }));
    expect(screen.queryByText(/Court A/)).toBeNull();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledTimes(2);
    await act(async () => resolve({ bookings: [booking({ id: 'b7', reference: 'BK-7', turf: { name: 'Court B' } })] }));
    expect(await screen.findByText(/Court B/)).toBeTruthy();
    expect(screen.queryByText(/Court A/)).toBeNull();
  });

  it('switching accounts without signing out reloads for the new one', async () => {
    mockGet.mockResolvedValueOnce({ bookings: [booking()] });
    const view = await render(wrap(<BookingsScreen />));
    expect(await screen.findByText(/Court A/)).toBeTruthy();
    let resolve!: (v: unknown) => void;
    mockGet.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await view.rerender(wrap(<BookingsScreen />, { user: { ...user, id: 'u2' } }));
    expect(screen.queryByText(/Court A/)).toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(2);
    await act(async () => resolve({ bookings: [] }));
    expect(await screen.findByText('You have no upcoming bookings.')).toBeTruthy();
  });

  it('pull to refresh refetches', async () => {
    mockGet.mockResolvedValueOnce({ bookings: [booking()] });
    await render(wrap(<BookingsScreen />));
    await screen.findByText(/Court A/);
    mockGet.mockResolvedValueOnce({ bookings: [booking(), booking({ id: 'b9', reference: 'BK-9', turf: { name: 'Court New' } })] });
    const list = screen.getByTestId('bookings-list');
    await act(async () => {
      await list.props.refreshControl.props.onRefresh();
    });
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/Court New/)).toBeTruthy();
  });

  it('a failed load shows the error with a retry; empty tabs say so', async () => {
    mockGet.mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'));
    await render(wrap(<BookingsScreen />));
    expect(await screen.findByRole('alert')).toBeTruthy();
    mockGet.mockResolvedValueOnce({ bookings: [] });
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('You have no upcoming bookings.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Past' }));
    expect(screen.getByText('No past bookings yet.')).toBeTruthy();
  });
});

describe('booking detail', () => {
  const renderDetail = (value: Partial<AuthContextValue> = {}) => render(wrap(<BookingDetailScreen />, value));

  it('shows reference, venue, court, venue-local time, amount and status', async () => {
    serveDetail();
    await renderDetail();
    expect(await screen.findByText('BK-1')).toBeTruthy();
    expect(screen.getByText('Arena One')).toBeTruthy();
    expect(screen.getByText(/Court A/)).toBeTruthy();
    expect(screen.getByText(/19:00/)).toBeTruthy();
    expect(screen.queryByText(/13:00/)).toBeNull();
    expect(screen.getAllByText(formatMoney(150000, 'BDT', 'en')).length).toBeGreaterThan(0);
    expect(screen.getByText('Confirmed')).toBeTruthy();
  });

  it('cancel shows the refund preview before confirming', async () => {
    serveDetail();
    mockPost.mockResolvedValue({ booking: booking({ status: 'cancelled' }), refunds: [] });
    await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel booking' }));
    expect(await screen.findByText('Your refund (50%)')).toBeTruthy();
    expect(screen.getAllByText(formatMoney(7500, 'BDT', 'en'), { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText(/refunded to your card/)).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Reason (optional)'), ' too far ');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm cancellation' }));
    expect(mockPost).toHaveBeenCalledWith('/me/bookings/b1/cancel', { reason: 'too far' });
    expect(await screen.findByText('Cancelled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).toBeNull();
  });

  it('confirm is disabled while the cancel is in flight and fires once', async () => {
    serveDetail();
    let resolve!: (v: unknown) => void;
    mockPost.mockReturnValue(new Promise((r) => (resolve = r)));
    await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel booking' }));
    await screen.findByText('Your refund (50%)');
    const confirm = () => screen.getByRole('button', { name: 'Confirm cancellation' });
    await fireEvent.press(confirm());
    await fireEvent.press(confirm());
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(confirm().props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => resolve({ booking: booking({ status: 'cancelled' }), refunds: [] }));
  });

  it('cancel not allowed shows the reason from the API', async () => {
    serveDetail();
    mockPost.mockRejectedValue(new ApiError(409, 'too_late', 'This booking has already started'));
    await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel booking' }));
    await screen.findByText('Your refund (50%)');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm cancellation' }));
    await screen.findByRole('alert');
    expect(screen.getByText(/too late/i)).toBeTruthy();
    // A final answer: nothing left to confirm.
    expect(screen.queryByRole('button', { name: 'Confirm cancellation' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Keep booking' })).toBeTruthy();
  });

  it('nothing paid says there is nothing to refund', async () => {
    serveDetail(booking({ status: 'pending', amountPaid: 0 }));
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/me/bookings/b1') return { booking: booking({ status: 'pending', amountPaid: 0 }), refunds: [], group: [] };
      if (path === '/me/bookings/b1/cancellation') return { preview: preview({ amountPaid: 0, amount: 0, percent: 0, card: 0 }) };
      return { venue: { location: null } };
    });
    await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel booking' }));
    expect(await screen.findByText(/Nothing has been paid yet/)).toBeTruthy();
  });

  it('awaiting payment offers Pay now, not Book again, and routes to the pay screen', async () => {
    serveDetail(booking({ status: 'awaiting_payment', paymentStatus: 'unpaid', amountPaid: 0 }));
    await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Pay now' }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/booking/[id]/pay', params: { id: 'b1' } });
    expect(screen.queryByRole('button', { name: 'Book again' })).toBeNull();
  });

  it('arriving from a card payment still being confirmed says so and hides Pay now', async () => {
    mockParams = { id: 'b1', confirming: '1' };
    serveDetail(booking({ status: 'awaiting_payment', paymentStatus: 'unpaid', amountPaid: 0, holdExpiresAt: new Date(NOW + 10 * 60_000).toISOString() }));
    await renderDetail();
    expect(await screen.findByText('Payment received, confirming…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pay now' })).toBeNull();
  });

  it('the confirming notice goes once the booking is confirmed', async () => {
    mockParams = { id: 'b1', confirming: '1' };
    serveDetail();
    await renderDetail();
    expect(await screen.findByText('BK-1')).toBeTruthy();
    expect(screen.getByText('Confirmed')).toBeTruthy();
    expect(screen.queryByText('Payment received, confirming…')).toBeNull();
  });

  it('a manual wallet payment awaiting the venue shows provider and Transaction ID, never Pay now', async () => {
    serveDetail(
      booking({
        status: 'pending',
        manualPayment: { provider: 'bkash', trxId: 'TX123', amount: 15000, status: 'pending', submittedAt: new Date(NOW).toISOString() },
      }),
    );
    await renderDetail();
    expect(await screen.findByText(/Waiting for the venue to check your payment \(bKash TX123\)/)).toBeTruthy();
    expect(screen.getByText('Payment to check')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pay now' })).toBeNull();
  });

  it('a late manual payment on an expired booking says the times were taken', async () => {
    serveDetail(
      booking({
        status: 'expired',
        manualPayment: { provider: 'nagad', trxId: 'TX9', amount: 15000, status: 'pending', submittedAt: new Date(NOW).toISOString() },
      }),
    );
    await renderDetail();
    expect(await screen.findByText(/These times were taken while you paid/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pay now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).toBeNull();
  });

  it('Book again opens the venue with the same court preselected', async () => {
    serveDetail(past('b1'));
    await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Book again' }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/venue/[slug]', params: { slug: 'arena-one', turfId: 't1' } });
  });

  it('Open in Maps uses the venue coordinates; no coordinates, no link', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockImplementation(async () => undefined);
    serveDetail();
    const view = await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Open in Maps' }));
    expect(open).toHaveBeenCalledWith('https://www.google.com/maps/search/?api=1&query=23.8,90.4');
    await view.unmount();

    serveDetail(booking(), null);
    await renderDetail();
    await screen.findByText('BK-1');
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Open in Maps' })).toBeNull();
  });

  it('signed out shows the sign-in prompt', async () => {
    await renderDetail({ status: 'signedOut', user: null });
    expect(await screen.findByText('Sign in to see your bookings.')).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
