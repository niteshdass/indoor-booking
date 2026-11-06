import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SYSTEM_ROLES } from '@booking/shared';
import TodayRoute from '../../../app/owner/[ownerId]/(tabs)/today';
import type { OwnerBooking } from '../../../src/owner/types';
import { makeBooking } from '../booking/fixtures';
import { OwnerWrap, ownerValue } from '../ownerFixture';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ get router() { return mockRouter; }, useRouter: () => mockRouter, useLocalSearchParams: () => ({ ownerId: 'o1' }) , useFocusEffect: (cb: () => void) => mockUseFocus(cb) }));

// Runs the focus callback once on mount, like a screen gaining focus; `mockRefocus()` runs it again.
const mockFocused: (() => void)[] = [];
function mockUseFocus(cb: () => void) {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  mockFocused.push(cb);
  useEffect(() => cb(), [cb]);
}
const mockRefocus = () => new Set(mockFocused).forEach((cb) => cb());


const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../src/lib/api', () => {
  const actual = jest.requireActual('../../../src/lib/api');
  return { ...actual, apiGet: (...a: unknown[]) => mockGet(...a), apiPost: (...a: unknown[]) => mockPost(...a) };
});

let today: OwnerBooking[] = [];
let toSend: { id: string }[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused.length = 0;
  mockGet.mockImplementation(async (path: string) => {
    if (path.endsWith('/turfs')) return { turfs: [] };
    if (path.startsWith('/owners/o1/series?')) return { series: [] };
    if (path.startsWith('/owners/o1/refunds?')) return { refunds: toSend, nextBefore: null };
    if (path.includes('scope=to_verify')) return { bookings: [], total: 0 };
    if (path.includes('from=')) return { bookings: [] };
    if (path === '/owners/o1/bookings?venueId=v1') return { bookings: today };
    throw new Error(`unexpected ${path}`);
  });
});

const renderToday = (over?: Parameters<typeof ownerValue>[0]) =>
  render(
    <OwnerWrap value={ownerValue(over)}>
      <TodayRoute />
    </OwnerWrap>,
  );

describe('today tab', () => {
  it('says so, and loads nothing, for a role that cannot see bookings', async () => {
    await renderToday({ perms: ['venue.manage'] });
    expect(await screen.findByText('Your role cannot see bookings. Open More for the pages you can use.')).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('reloads when the tab comes back into focus', async () => {
    today = [makeBooking('b2', 'Mina', {}, 3)];
    await renderToday();
    expect(await screen.findAllByText('Mina')).toBeTruthy();
    const loads = () => mockGet.mock.calls.filter(([p]) => p === '/owners/o1/bookings?venueId=v1').length;
    expect(loads()).toBe(1);
    today = [makeBooking('b2', 'Mina', {}, 3), makeBooking('b3', 'Tanvir', {}, 4)];
    await act(async () => mockRefocus());
    expect(loads()).toBe(2);
    expect((await screen.findAllByText('Tanvir')).length).toBeGreaterThan(0);
  });

  it('shows stats, what needs attention and what is coming up', async () => {
    today = [makeBooking('b1', 'Rafi', { status: 'pending' }, 2), makeBooking('b2', 'Mina', {}, 3)];
    await renderToday();
    expect(await screen.findByText('Bookings today')).toBeTruthy();
    expect(screen.getByText('1 waiting for confirmation')).toBeTruthy();
    expect(screen.getByText('Coming up')).toBeTruthy();
    expect(screen.getAllByText('Mina').length).toBeGreaterThan(0);
    expect(mockGet).toHaveBeenCalledWith('/owners/o1/bookings?venueId=v1');
  });

  it('confirms inline from Needs you', async () => {
    const b = makeBooking('b1', 'Rafi', { status: 'pending' }, 2);
    today = [b];
    mockPost.mockResolvedValue({ booking: { ...b, status: 'confirmed' } });
    await renderToday();
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirm' }));
    await act(async () => {});
    expect(mockPost).toHaveBeenCalledWith('/owners/o1/bookings/b1/confirm', {});
  });

  it('hides the pending stat and confirm from staff', async () => {
    today = [makeBooking('b1', 'Rafi', { status: 'pending' }, 2)];
    await renderToday({ perms: SYSTEM_ROLES.staff });
    expect(await screen.findByText('Bookings today')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(screen.queryByText('Waiting for confirmation')).toBeNull();
  });

  it('lists wallet refunds to send under Needs you and opens the list', async () => {
    today = [];
    toSend = [{ id: 'r1' }, { id: 'r2' }];
    await renderToday();
    expect(await screen.findByText('2 waiting to be sent')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/owners/o1/refunds?method=wallet&status=pending&venueId=v1');
    await fireEvent.press(screen.getByRole('button', { name: 'Refunds to send, 2 waiting to be sent' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/owner/o1/refunds');
    toSend = [];
  });

  it('skips refunds to send without payment.verify', async () => {
    today = [];
    toSend = [{ id: 'r1' }];
    await renderToday({ perms: SYSTEM_ROLES.staff });
    expect(await screen.findByText('Bookings today')).toBeTruthy();
    expect(screen.queryByText('Refunds to send')).toBeNull();
    expect(mockGet).not.toHaveBeenCalledWith(expect.stringContaining('/refunds'));
    toSend = [];
  });

  it('switches to the schedule', async () => {
    today = [];
    await renderToday();
    await fireEvent.press(await screen.findByRole('tab', { name: 'Schedule' }));
    expect(await screen.findByText('No active courts')).toBeTruthy();
  });
});
