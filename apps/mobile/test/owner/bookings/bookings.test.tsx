import { act, fireEvent, render, screen } from '@testing-library/react-native';
import BookingsScreen from '../../../app/owner/[ownerId]/(tabs)/bookings';
import type { OwnerBooking } from '../../../src/owner/types';
import { OwnerWrap, ownerValue, venue } from '../ownerFixture';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ get router() { return mockRouter; }, useRouter: () => mockRouter, useLocalSearchParams: () => mockParams , useFocusEffect: (cb: () => void) => mockUseFocus(cb) }));

// Runs the focus callback once on mount, like a screen gaining focus; `mockRefocus()` runs it again.
const mockFocused: (() => void)[] = [];
function mockUseFocus(cb: () => void) {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  mockFocused.push(cb);
  useEffect(() => cb(), [cb]);
}
const mockRefocus = () => new Set(mockFocused).forEach((cb) => cb());

let mockParams: Record<string, string> = {};

const mockGet = jest.fn();
jest.mock('../../../src/lib/api', () => {
  const actual = jest.requireActual('../../../src/lib/api');
  return { ...actual, apiGet: (...a: unknown[]) => mockGet(...a) };
});


const booking = (id: string, name: string, over: Partial<OwnerBooking> = {}): OwnerBooking =>
  ({
    id,
    reference: `BK-${id}`,
    venueId: 'v1',
    turfId: 't1',
    businessDate: '2030-01-10',
    slots: [{ startAt: '2030-01-10T12:00:00.000Z', endAt: '2030-01-10T13:00:00.000Z', price: 150000 }],
    addons: [],
    currency: 'BDT',
    subtotal: 150000,
    addonsTotal: 0,
    total: 150000,
    advanceRequired: 0,
    coupon: null,
    platformFee: null,
    amountPaid: 0,
    amountRefunded: 0,
    status: 'confirmed',
    paymentStatus: 'unpaid',
    holdExpiresAt: null,
    source: 'walkin',
    playerId: null,
    guest: null,
    seriesId: null,
    groupId: null,
    rejectReason: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: '2030-01-01T00:00:00.000Z',
    rescheduleCount: 0,
    rescheduledAt: null,
    customer: { name, phone: '+8801700000000', email: null },
    turf: { name: 'Court A' },
    manualPayment: null,
    ...over,
  }) as OwnerBooking;

const page1 = Array.from({ length: 25 }, (_, i) => booking(`b${i + 1}`, `Player ${i + 1}`));

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused.length = 0;
  mockParams = {};
  mockGet.mockImplementation(async (path: string) => {
    if (path.endsWith('/turfs')) return { turfs: [] };
    if (path.includes('/bookings?')) {
      const page = new URLSearchParams(path.split('?')[1]).get('page');
      return page === '1' ? { bookings: page1, total: 26 } : { bookings: [booking('b26', 'Last Player')], total: 26 };
    }
    throw new Error(`unexpected ${path}`);
  });
});

const renderBookings = (over?: Parameters<typeof ownerValue>[0]) =>
  render(
    <OwnerWrap value={ownerValue(over)}>
      <BookingsScreen />
    </OwnerWrap>,
  );

describe('bookings tab', () => {
  it('reloads the first page when the tab comes back into focus', async () => {
    await renderBookings();
    expect(await screen.findByText('Player 1')).toBeTruthy();
    const firstPage = '/owners/o1/bookings?scope=all&sort=created-desc&page=1&pageSize=25';
    expect(mockGet.mock.calls.filter(([p]) => p === firstPage)).toHaveLength(1);
    await act(async () => mockRefocus());
    expect(mockGet.mock.calls.filter(([p]) => p === firstPage)).toHaveLength(2);
    expect(screen.getByText('Player 1')).toBeTruthy();
  });

  it('lists bookings with customer, court, amount and status', async () => {
    await renderBookings();
    expect(await screen.findByText('Player 1')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/owners/o1/bookings?scope=all&sort=created-desc&page=1&pageSize=25');
    expect(screen.getAllByText(/Court A/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1,500/).length).toBeGreaterThan(0);
  });

  it('opens the booking on tap', async () => {
    await renderBookings();
    await fireEvent.press(await screen.findByLabelText(/Player 1,/));
    expect(mockRouter.push).toHaveBeenCalledWith('/owner/o1/booking/b1');
  });

  it('loads the next page at the end of the list', async () => {
    await renderBookings();
    await screen.findByText('Player 1');
    await fireEvent(screen.getByTestId('owner-bookings-list'), 'endReached');
    await act(async () => {});
    expect(mockGet).toHaveBeenCalledWith('/owners/o1/bookings?scope=all&sort=created-desc&page=2&pageSize=25');
  });

  it('switches tab with its default sort', async () => {
    await renderBookings();
    await screen.findByText('Player 1');
    await fireEvent.press(screen.getByRole('tab', { name: 'Today' }));
    await act(async () => {});
    expect(mockGet).toHaveBeenCalledWith('/owners/o1/bookings?scope=today&sort=date-asc&page=1&pageSize=25');
  });

  it('shows the venue on rows when there are several venues', async () => {
    await renderBookings({ venues: [venue, { ...venue, id: 'v2', name: 'Arena Two' }] });
    expect(await screen.findByText('Player 1')).toBeTruthy();
    expect(screen.getAllByText(/Arena One/).length).toBeGreaterThan(0);
  });

  it('opens on the tab and venue a link asks for', async () => {
    mockParams = { tab: 'dues', venue: 'v2' };
    await renderBookings({ venues: [venue, { ...venue, id: 'v2', name: 'Arena Two' }] });
    await screen.findByText('Player 1');
    expect(mockGet).toHaveBeenCalledWith('/owners/o1/bookings?scope=dues&sort=date-asc&page=1&pageSize=25&venueId=v2');
    expect(screen.getByRole('button', { name: 'Venue, Arena Two' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Dues', selected: true })).toBeTruthy();
  });
});
