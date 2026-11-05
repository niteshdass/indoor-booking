import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SYSTEM_ROLES, type SeriesJson, type SeriesPreview } from '@booking/shared';
import SeriesListScreen from '../../../app/owner/[ownerId]/series/index';
import SeriesDetailScreen from '../../../app/owner/[ownerId]/series/[id]';
import NewSeriesScreen from '../../../app/owner/[ownerId]/series/new';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OwnerWrap as BaseWrap, ownerValue } from '../ownerFixture';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
function OwnerWrap(props: Parameters<typeof BaseWrap>[0]) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <BaseWrap {...props} />
    </SafeAreaProvider>
  );
}

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../src/lib/api', () => {
  const actual = jest.requireActual('../../../src/lib/api');
  return { ...actual, apiGet: (...a: unknown[]) => mockGet(...a), apiPost: (...a: unknown[]) => mockPost(...a) };
});

const turf = { id: 't1', venueId: 'v1', name: 'Court 1', sports: ['futsal'], indoor: true, slotLengthMin: 60, active: true, settings: {}, pricing: null, effectiveSettings: {}, createdAt: '' };

const game = (id: string, date: string) => ({
  id,
  reference: `BK-${id}`,
  businessDate: date,
  startAt: `${date}T14:00:00.000Z`,
  endAt: `${date}T15:00:00.000Z`,
  status: 'pending' as const,
  total: 270000,
  amountPaid: 0,
});

const requested: SeriesJson = {
  id: 's1',
  venueId: 'v1',
  turfId: 't1',
  status: 'requested',
  source: 'online',
  pattern: { weekdays: ['sat'], startTime: '20:00', slotCount: 1, firstDate: '2026-11-07', endDate: null, count: 3 },
  currency: 'BDT',
  player: null,
  guest: { name: 'Dhaka Strikers FC', phone: '01711220033' },
  skipped: [{ date: '2026-11-14', reason: 'taken' }],
  respondBy: '2026-11-07T06:00:00.000Z',
  declineReason: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  games: [game('g1', '2026-11-07'), game('g2', '2026-11-21')],
};
const active: SeriesJson = { ...requested, id: 's2', status: 'active', guest: { name: 'Office League', phone: '01933778899' }, respondBy: null, skipped: [] };

function routeGet(path: string) {
  if (path.endsWith('/turfs')) return Promise.resolve({ turfs: [turf] });
  if (path.includes('/slots?')) return Promise.resolve({ day: { businessDate: '', currency: 'BDT', closed: false, closedReason: null, inWindow: true, slots: [{ localStart: '19:00' }, { localStart: '20:00' }] } });
  if (path.startsWith('/owners/o1/series/s1')) return Promise.resolve({ series: requested });
  if (path.includes('status=requested')) return Promise.resolve({ series: [requested], nextBefore: null });
  if (path.startsWith('/owners/o1/series?')) return Promise.resolve({ series: [requested, active], nextBefore: 'cursor' });
  return Promise.reject(new Error(`unexpected ${path}`));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockGet.mockImplementation(routeGet);
});

describe('series list', () => {
  it('lists the venue series, pages and opens one', async () => {
    await render(
      <OwnerWrap>
        <SeriesListScreen />
      </OwnerWrap>,
    );
    expect(await screen.findByText('Dhaka Strikers FC')).toBeTruthy();
    expect(screen.getByText('Office League')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/owners/o1/series?venueId=v1');

    mockGet.mockResolvedValueOnce({ series: [], nextBefore: null });
    await fireEvent.press(screen.getByRole('button', { name: 'Show more' }));
    expect(mockGet).toHaveBeenLastCalledWith('/owners/o1/series?venueId=v1&before=cursor');

    await fireEvent.press(screen.getByRole('button', { name: /^Dhaka Strikers FC/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/owner/o1/series/s1');

    await fireEvent.press(screen.getByRole('button', { name: 'Active' }));
    await act(async () => {});
    expect(mockGet).toHaveBeenLastCalledWith('/owners/o1/series?venueId=v1&status=active');
  });

  it('hides New series without booking.create', async () => {
    await render(
      <OwnerWrap value={ownerValue({ perms: ['booking.view'] })}>
        <SeriesListScreen />
      </OwnerWrap>,
    );
    await screen.findByText('Dhaka Strikers FC');
    expect(screen.queryByRole('button', { name: 'New series' })).toBeNull();
  });
});

describe('series detail', () => {
  it('shows a request with free and clashing dates and accepts it', async () => {
    mockParams = { id: 's1' };
    mockPost.mockResolvedValue({ series: { ...requested, status: 'active' } });
    await render(
      <OwnerWrap>
        <SeriesDetailScreen />
      </OwnerWrap>,
    );
    expect(await screen.findByText('Dhaka Strikers FC')).toBeTruthy();
    expect(screen.getByText(/^Answer by/)).toBeTruthy();
    expect(screen.getByText('Clash · Already booked')).toBeTruthy();
    expect(screen.getAllByText('Free')).toHaveLength(2);
    await fireEvent.press(screen.getByRole('button', { name: 'Accept 2 games' }));
    await act(async () => {});
    expect(mockPost).toHaveBeenCalledWith('/owners/o1/series/s1/accept', {});
    expect(await screen.findByText('Active')).toBeTruthy();
  });

  it('declines with a reason', async () => {
    mockParams = { id: 's1' };
    mockPost.mockResolvedValue({ series: { ...requested, status: 'declined', declineReason: 'Full' } });
    await render(
      <OwnerWrap>
        <SeriesDetailScreen />
      </OwnerWrap>,
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Decline' }));
    await fireEvent.changeText(screen.getByLabelText('Reason (optional)'), ' Full ');
    const buttons = screen.getAllByRole('button', { name: 'Decline' });
    await fireEvent.press(buttons[buttons.length - 1]!);
    await act(async () => {});
    expect(mockPost).toHaveBeenCalledWith('/owners/o1/series/s1/decline', { reason: 'Full' });
  });

  it('hides accept and decline without booking.confirm', async () => {
    mockParams = { id: 's1' };
    await render(
      <OwnerWrap value={ownerValue({ perms: SYSTEM_ROLES.staff })}>
        <SeriesDetailScreen />
      </OwnerWrap>,
    );
    await screen.findByText('Dhaka Strikers FC');
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
  });
});

describe('new series', () => {
  const preview: SeriesPreview = {
    currency: 'BDT',
    dates: [
      { date: '2026-11-07', status: 'free', startAt: '2026-11-07T13:00:00.000Z', endAt: '2026-11-07T14:00:00.000Z', price: 180000 },
      { date: '2026-11-14', status: 'clash', reason: 'closed' },
    ],
    freeCount: 1,
    total: 180000,
    platformFee: null,
  };

  it('checks dates, then creates the series for the customer', async () => {
    mockPost.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/preview') ? { preview } : { series: { ...active, id: 's9' } }),
    );
    await render(
      <OwnerWrap>
        <NewSeriesScreen />
      </OwnerWrap>,
    );
    await fireEvent.press(await screen.findByRole('button', { name: '20:00' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Check dates' }));
    await act(async () => {});
    const body = mockPost.mock.calls[0]![1] as Record<string, unknown>;
    expect(mockPost.mock.calls[0]![0]).toBe('/owners/o1/venues/v1/turfs/t1/series/preview');
    expect(body).toMatchObject({ startTime: '20:00', slotCount: 1, endDate: null, count: 10 });
    expect(screen.getByText('Closed')).toBeTruthy();

    // Customer is required before booking.
    await fireEvent.press(screen.getByRole('button', { name: 'Book 1 game' }));
    expect(screen.getByText('Enter the customer name (up to 80 characters).')).toBeTruthy();
    expect(mockPost).toHaveBeenCalledTimes(1);

    await fireEvent.changeText(screen.getByLabelText('Customer name'), 'Office League');
    await fireEvent.changeText(screen.getByLabelText('Phone'), '01933778899');
    await fireEvent.press(screen.getByRole('button', { name: 'Book 1 game' }));
    await act(async () => {});
    expect(mockPost).toHaveBeenLastCalledWith('/owners/o1/venues/v1/turfs/t1/series', {
      ...body,
      customer: { name: 'Office League', phone: '01933778899' },
    });
    expect(mockRouter.replace).toHaveBeenCalledWith('/owner/o1/series/s9');
  });

  it('is closed to members without booking.create', async () => {
    await render(
      <OwnerWrap value={ownerValue({ perms: ['booking.view'] })}>
        <NewSeriesScreen />
      </OwnerWrap>,
    );
    expect(await screen.findByText('Your role cannot add series.')).toBeTruthy();
  });
});
