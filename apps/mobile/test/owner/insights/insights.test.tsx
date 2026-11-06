import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SYSTEM_ROLES } from '@booking/shared';
import InsightsScreen from '../../../app/owner/[ownerId]/(tabs)/insights';
import type { Overview } from '../../../src/owner/insights/types';
import { OwnerWrap, ownerValue } from '../ownerFixture';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ get router() { return mockRouter; }, useRouter: () => mockRouter, useLocalSearchParams: () => ({}) }));

const mockGet = jest.fn();
jest.mock('../../../src/lib/api', () => {
  const actual = jest.requireActual('../../../src/lib/api');
  return { ...actual, apiGet: (...a: unknown[]) => mockGet(...a) };
});

const day = (date: string, online: number, walkin: number) => ({
  date,
  online,
  walkin,
  bookings: 2,
  minutes: 120,
  previous: { revenue: 1000, bookings: 1, minutes: 60 },
});

const overview: Overview = {
  range: { from: '2026-10-07', to: '2026-11-05', days: 30, previous: { from: '2026-09-07', to: '2026-10-06' } },
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
  platformFees: 0,
  kpis: {
    revenue: { value: 420000, previous: 375000 },
    bookings: { value: 318, previous: 294 },
    minutes: { value: 6000, previous: 6000 },
    utilization: { value: 0.64, previous: 0.61 },
    averageBooking: { value: 132000, previous: 135000 },
    cancellationRate: { value: 0.041, previous: 0.051 },
  },
  daily: Array.from({ length: 14 }, (_, i) => day(`2026-10-${String(i + 7).padStart(2, '0')}`, 10000, 5000)),
  mix: { courts: 400000, addons: 20000, cancellationFees: 0, collected: 408600, outstanding: 1140000 },
  heatmap: [],
  courts: [
    { id: 't1', name: 'Court 1', revenue: 1, bookings: 1, minutes: 820, openMinutes: 1000, previousRevenue: 1 },
    { id: 't2', name: 'Padel A', revenue: 1, bookings: 1, minutes: 710, openMinutes: 1000, previousRevenue: 1 },
  ],
  statuses: {},
  players: { value: 1, previous: 1, newValue: 0, newPrevious: 0 },
  methods: [
    { method: 'wallet', amount: 4600, count: 10 },
    { method: 'cash', amount: 3100, count: 8 },
    { method: 'card', amount: 2300, count: 2 },
  ],
  recent: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue(overview);
});

describe('owner insights', () => {
  it('loads the venue overview and shows KPIs, charts with text labels, and what is owed', async () => {
    await render(
      <OwnerWrap>
        <InsightsScreen />
      </OwnerWrap>,
    );
    expect(await screen.findByText('Revenue')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/owners/o1/reports/overview?venueId=v1&days=30');
    expect(screen.getByText('Bookings')).toBeTruthy();
    expect(screen.getByText('Cancellations')).toBeTruthy();
    expect(screen.getByText('Revenue by week')).toBeTruthy();
    expect(screen.getByLabelText(/^Payments received\. Wallet: 46%/)).toBeTruthy();
    expect(screen.getByLabelText(/^Busiest turfs\. Court 1: 82% used/)).toBeTruthy();
    expect(screen.getByText('Still to collect')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: /Still to collect/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/owner/o1/bookings?tab=dues&venue=v1');
  });

  it('switches the period', async () => {
    await render(
      <OwnerWrap>
        <InsightsScreen />
      </OwnerWrap>,
    );
    await screen.findByText('Revenue');
    await fireEvent.press(screen.getByRole('tab', { name: '7 days' }));
    await act(async () => {});
    expect(mockGet).toHaveBeenLastCalledWith('/owners/o1/reports/overview?venueId=v1&days=7');
  });

  it('shows nothing but a note without reports.view', async () => {
    await render(
      <OwnerWrap value={ownerValue({ perms: SYSTEM_ROLES.staff })}>
        <InsightsScreen />
      </OwnerWrap>,
    );
    expect(await screen.findByText('Your role cannot see insights.')).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
