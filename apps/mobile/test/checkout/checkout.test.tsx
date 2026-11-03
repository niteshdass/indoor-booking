import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { formatMoney } from '@booking/shared';
import { AuthContext, type AuthContextValue } from '../../src/auth/useAuth';
import { ApiError } from '../../src/lib/api';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import CheckoutScreen from '../../app/venue/[slug]/checkout';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-11-05T13:00:00Z'); // 19:00 in Dhaka
const iso = (i: number) => new Date(T0 + i * HOUR).toISOString();

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({
    slug: 'arena-one',
    turfId: 't1',
    date: '2026-11-05',
    startAts: [new Date(Date.parse('2026-11-05T13:00:00Z')).toISOString(), new Date(Date.parse('2026-11-05T14:00:00Z')).toISOString()].join(','),
  }),
}));

let mockUuid = 0;
let advancePct = 10;
jest.mock('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-00000000000${++mockUuid}` }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../src/lib/api', () => {
  const actual = jest.requireActual('../../src/lib/api');
  return { ...actual, apiGet: (...a: unknown[]) => mockGet(...a), apiPost: (...a: unknown[]) => mockPost(...a) };
});

const venue = {
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
  rating: null,
  turfs: [{ id: 't1', name: 'Court A', sports: ['futsal'], indoor: true, slotLengthMin: 60 }],
};
const addons = [
  { id: 'a1', name: 'Bibs', pricingType: 'per_booking', unitPrice: 10000, maxQuantity: 1, autoApply: null },
  { id: 'a2', name: 'Water', pricingType: 'per_unit', unitPrice: 5000, maxQuantity: 5, autoApply: null },
];
const PRICE = 150000;

type Body = { date: string; startAts: string[]; addons: { addonId: string; quantity?: number }[]; couponCode?: string };

function quoteFor(body: Body) {
  const lines = body.addons.map((s) => {
    const a = addons.find((x) => x.id === s.addonId)!;
    const quantity = s.quantity ?? 1;
    return { addonId: a.id, name: a.name, pricingType: a.pricingType, unitPrice: a.unitPrice, quantity, minutes: null, total: a.unitPrice * quantity, auto: false };
  });
  const subtotal = body.startAts.length * PRICE;
  const addonsTotal = lines.reduce((n, l) => n + l.total, 0);
  const discount = body.couponCode === 'GOOD10' ? 10000 : 0;
  const total = subtotal + addonsTotal - discount;
  return {
    quote: {
      currency: 'BDT',
      slots: body.startAts.map((s) => ({ startAt: s, endAt: new Date(Date.parse(s) + HOUR).toISOString(), price: PRICE })),
      addons: lines,
      subtotal,
      addonsTotal,
      discount,
      total,
      advanceRequired: Math.round((total * advancePct) / 100),
      platformFee: null,
    },
    coupon: discount ? { code: 'GOOD10', type: 'fixed', value: 10000, discount } : null,
    guestAllowed: false,
    guestOtpRequired: false,
    paymentMethods: { wallets: ['bkash'], card: true, sslcommerz: false },
  };
}

const booking = (status = 'awaiting_payment') => ({ id: 'b1', reference: 'BK-1', status, total: 300000, advanceRequired: 30000, currency: 'BDT' });

function serve(onBook?: (body: Body, headers?: Record<string, string>) => unknown) {
  mockGet.mockImplementation(async (path: string) => {
    if (path === '/venues/arena-one') return { venue };
    if (path === '/venues/arena-one/turfs/t1/addons') return { currency: 'BDT', addons };
    throw new Error(`unexpected GET ${path}`);
  });
  mockPost.mockImplementation(async (path: string, body: Body, headers?: Record<string, string>) => {
    if (path === '/venues/arena-one/turfs/t1/quote') {
      if (body.couponCode && body.couponCode !== 'GOOD10') throw new ApiError(400, 'coupon_invalid', 'bad code');
      return quoteFor(body);
    }
    if (path === '/venues/arena-one/turfs/t1/bookings') {
      const out = onBook ? onBook(body, headers) : { booking: booking() };
      if (out instanceof Error) throw out;
      return out;
    }
    throw new Error(`unexpected POST ${path}`);
  });
}

const user = { id: 'u1', name: 'Asha', email: 'a@b.c', emailVerified: true, phone: '+8801712345678', hasPassword: true, hasGoogle: false, platformAdmin: false };
const auth: AuthContextValue = { status: 'signedIn', user, signIn: jest.fn(), setUser: jest.fn(), signOut: jest.fn(), retry: jest.fn() };

const renderCheckout = (value: Partial<AuthContextValue> = {}) =>
  render(
    <ThemeProvider>
      <AuthContext.Provider value={{ ...auth, ...value }}>
        <CheckoutScreen />
      </AuthContext.Provider>
    </ThemeProvider>,
  );

const money = (n: number) => formatMoney(n, 'BDT', 'en');
const quoteCalls = () => mockPost.mock.calls.filter((c) => String(c[0]).endsWith('/quote'));
const bookCalls = () => mockPost.mock.calls.filter((c) => String(c[0]).endsWith('/bookings'));

beforeEach(() => {
  jest.clearAllMocks();
  mockUuid = 0;
  advancePct = 10;
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(new Date('2026-11-05T10:00:00Z'));
});
afterEach(() => jest.useRealTimers());

describe('checkout screen', () => {
  it('quote updates when add-ons change', async () => {
    serve();
    await renderCheckout();
    const total = await screen.findByTestId('quote-total');
    expect(within(total).getByText(money(300000))).toBeTruthy();
    // Slot times are shown on the venue clock (Dhaka, UTC+6).
    expect(screen.getByText(/19:00/)).toBeTruthy();

    await fireEvent.press(await screen.findByRole('checkbox', { name: /Bibs/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Increase Water' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Increase Water' }));

    expect(await within(screen.getByTestId('quote-total')).findByText(money(320000))).toBeTruthy();
    const last = quoteCalls().at(-1)![1] as Body;
    expect(last.addons).toEqual([
      { addonId: 'a1', quantity: 1 },
      { addonId: 'a2', quantity: 2 },
    ]);
  });

  it('invalid promo shows its error and keeps the old total', async () => {
    serve();
    await renderCheckout();
    await screen.findByTestId('quote-total');

    await fireEvent.changeText(screen.getByLabelText('Promo code'), 'bad1');
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText("This promo code isn't valid.")).toBeTruthy();
    expect(quoteCalls().some((c) => (c[1] as Body).couponCode === 'BAD1')).toBe(true);
    expect(within(screen.getByTestId('quote-total')).getByText(money(300000))).toBeTruthy();
    // The refused code is dropped: the code-less quote lands and Book is usable again.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Book/ })).not.toBeDisabled());
    expect((quoteCalls().at(-1)![1] as Body).couponCode).toBeUndefined();
  });

  it('Book sends one Idempotency-Key, and a retry after a network error reuses it', async () => {
    let n = 0;
    serve(() => (++n === 1 ? new ApiError(0, 'network_error', 'offline') : { booking: booking() }));
    await renderCheckout();
    await screen.findByTestId('quote-total');

    await fireEvent.press(screen.getByRole('button', { name: `Book and pay ${money(30000)}` }));
    expect(await screen.findByText("Can't reach the server. Check your connection and try again.")).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: `Book and pay ${money(30000)}` }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());

    expect(bookCalls()).toHaveLength(2);
    const keys = bookCalls().map((c) => (c[2] as Record<string, string> | undefined)?.['Idempotency-Key']);
    expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/booking/[id]/pay', params: { id: 'b1' } });
  });

  it('a signed-out Book press goes to sign-in and keeps the checkout in next', async () => {
    serve();
    const view = await renderCheckout({ status: 'signedOut', user: null });
    await screen.findByTestId('quote-total');
    await fireEvent.press(screen.getByRole('button', { name: `Book and pay ${money(30000)}` }));
    expect(bookCalls()).toHaveLength(0);
    const href = mockRouter.push.mock.calls[0]![0] as string;
    expect(href.startsWith('/sign-in?next=')).toBe(true);
    const next = decodeURIComponent(href.slice('/sign-in?next='.length));
    expect(next).toBe(`/venue/arena-one/checkout?turfId=t1&date=2026-11-05&startAts=${encodeURIComponent(`${iso(0)},${iso(1)}`)}`);

    // Sign-in pops back to this same screen (see returnAfterSignIn): it picks up the new auth and books under the
    // Idempotency-Key it minted on arrival, so there is no second checkout and no second key.
    await view.rerender(
      <ThemeProvider>
        <AuthContext.Provider value={auth}>
          <CheckoutScreen />
        </AuthContext.Provider>
      </ThemeProvider>,
    );
    expect(screen.queryByText('Sign in or create an account to book.')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: `Book and pay ${money(30000)}` }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/booking/[id]/pay', params: { id: 'b1' } }));
    expect(bookCalls()).toHaveLength(1);
    expect((bookCalls()[0]![2] as Record<string, string>)['Idempotency-Key']).toBe('00000000-0000-4000-8000-000000000001');
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it('pay at venue: no advance books with "Book" and goes to the booking, not the pay screen', async () => {
    advancePct = 0;
    serve(() => ({ booking: { ...booking('confirmed'), advanceRequired: 0 } }));
    await renderCheckout();
    await screen.findByTestId('quote-total');
    expect(screen.queryByText('Due now')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Book' }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/booking/[id]', params: { id: 'b1' } }));
  });

  it('after an ambiguous Book failure, extras and promo code are locked so a retry matches what may have been booked', async () => {
    let n = 0;
    serve(() => (++n === 1 ? new ApiError(0, 'network_error', 'offline') : new ApiError(409, 'too_many_holds', 'holds')));
    await renderCheckout();
    await screen.findByTestId('quote-total');
    await fireEvent.press(screen.getByRole('button', { name: `Book and pay ${money(30000)}` }));
    await screen.findByText("Can't reach the server. Check your connection and try again.");

    expect(screen.getByRole('checkbox', { name: /Bibs/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase Water' })).toBeDisabled();
    expect(screen.getByLabelText('Promo code').props.editable).toBe(false);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByText('Extras and the promo code are locked while this booking may still be going through. Tap Book again to check.')).toBeTruthy();

    // A definite answer (here a refusal) means nothing was booked under the key: editing opens again.
    await fireEvent.press(screen.getByRole('button', { name: `Book and pay ${money(30000)}` }));
    await screen.findByText('You have too many unpaid or unconfirmed bookings. Pay for or cancel one first.');
    expect(screen.getByRole('checkbox', { name: /Bibs/ })).not.toBeDisabled();
  });
});
