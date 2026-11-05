import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { Permission } from '../../../src/owner/types';
import OwnerMoreScreen from '../../../app/owner/[ownerId]/(tabs)/more';
import { MENU, visibleMenu } from '../../../src/owner/more/menu';
import { OwnerWrap, ownerValue } from '../ownerFixture';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => {
      cb();
    }, [cb]);
  },
}));

const mockSignOut = jest.fn(async () => undefined);
jest.mock('../../../src/auth/useAuth', () => ({ useAuth: () => ({ signOut: mockSignOut }) }));

const mockGet = jest.fn();
jest.mock('../../../src/lib/api', () => ({ ...jest.requireActual('../../../src/lib/api'), apiGet: (...a: unknown[]) => mockGet(...a) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/owners/o1/series')) return { series: [{ id: 's1' }, { id: 's2' }], nextBefore: null };
    if (path === '/owners/o1/platform-fee') return { feeActive: false, balances: [] };
    if (path === '/owners/o1/refunds?method=wallet&status=pending') return { refunds: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }], nextBefore: 'r3' };
    throw new Error(`unexpected ${path}`);
  });
});

const show = async (perms?: readonly Permission[]) => {
  await render(
    <OwnerWrap value={ownerValue(perms ? { perms } : {})}>
      <OwnerMoreScreen />
    </OwnerWrap>,
  );
  await act(async () => {});
};

describe('owner More tab', () => {
  it('lists the portal by group with the open series request count', async () => {
    await show();
    expect(screen.getByText('Arena Group')).toBeTruthy();
    for (const label of ['Venues', 'Closures', 'Coupons', 'Staff']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/owners/o1/series?status=requested');
  });

  it('counts refunds to send, with + when more pages follow', async () => {
    await show();
    expect(screen.getByText('Refunds to send')).toBeTruthy();
    expect(screen.getByText('3+')).toBeTruthy();
    expect(screen.getByText('3+ waiting to be sent')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Refunds to send/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/owner/o1/refunds');
  });

  it('opens a section by its owner route', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Venues' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/owner/o1/venues');
  });

  it('hides sections the member cannot use and skips their requests', async () => {
    await show(['booking.view']);
    expect(screen.getByText('Venues')).toBeTruthy();
    for (const label of ['Closures', 'Coupons', 'Staff', 'Settings']) expect(screen.queryByText(label)).toBeNull();
    expect(mockGet).not.toHaveBeenCalledWith('/owners/o1/platform-fee');
    expect(screen.queryByText('Refunds to send')).toBeNull();
    expect(mockGet).not.toHaveBeenCalledWith(expect.stringContaining('/refunds'));
  });

  it('signs out after confirming', async () => {
    const { Alert } = jest.requireActual('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
      const buttons = args[2] as { onPress?: () => unknown }[];
      void buttons[1]!.onPress!();
    });
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    await act(async () => {});
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
    alert.mockRestore();
  });
});

describe('visibleMenu', () => {
  const can = (perms: string[]) => (p: Permission) => perms.includes(p);
  it('shows closures for either slot.override or settings.edit', () => {
    expect(visibleMenu(can(['slot.override']), false).map((m) => m.route)).toContain('/closures');
    expect(visibleMenu(can(['settings.edit']), false).map((m) => m.route)).toContain('/closures');
    expect(visibleMenu(can([]), false).map((m) => m.route)).toEqual(['/venues']);
  });
  it('shows platform fee only when the fee applies', () => {
    expect(visibleMenu(can(['settings.edit']), false).map((m) => m.route)).not.toContain('/platform-fee');
    expect(visibleMenu(can(['settings.edit']), true).map((m) => m.route)).toContain('/platform-fee');
  });
  it('shows refunds to send only with payment.verify', () => {
    expect(MENU.find((m) => m.route === '/refunds')).toMatchObject({ group: 'daily' });
    expect(visibleMenu(can(['payment.verify']), false).map((m) => m.route)).toContain('/refunds');
    expect(visibleMenu(can(['booking.view']), false).map((m) => m.route)).not.toContain('/refunds');
  });
});
