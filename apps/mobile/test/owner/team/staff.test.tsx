import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SYSTEM_ROLES } from '@booking/shared';
import StaffScreen from '../../../app/owner/[ownerId]/staff';
import type { Member, Role } from '../../../src/owner/types';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OwnerWrap, ownerValue } from '../ownerFixture';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  router: mockRouter,
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();
jest.mock('../../../src/lib/api', () => {
  const actual = jest.requireActual('../../../src/lib/api');
  return {
    ...actual,
    apiGet: (...a: unknown[]) => mockGet(...a),
    apiPost: (...a: unknown[]) => mockPost(...a),
    apiPatch: (...a: unknown[]) => mockPatch(...a),
    apiDelete: (...a: unknown[]) => mockDelete(...a),
  };
});

const roles: Role[] = [
  {
    id: 'r1',
    key: 'owner',
    name: 'Owner',
    system: true,
    permissions: [...SYSTEM_ROLES.owner],
    memberCount: 1,
  },
  {
    id: 'r2',
    key: 'manager',
    name: 'Manager',
    system: true,
    permissions: [...SYSTEM_ROLES.manager],
    memberCount: 1,
  },
  {
    id: 'r3',
    key: 'staff',
    name: 'Staff',
    system: true,
    permissions: [...SYSTEM_ROLES.staff],
    memberCount: 1,
  },
];
const user = (id: string, name: string) => ({ id, name, email: null, phone: '+8801711000000' });
const members: Member[] = [
  {
    id: 'm1',
    user: user('u1', 'Nitesh Das'),
    role: roles[0]!,
    venueIds: 'all',
    status: 'active',
    createdAt: '',
  },
  {
    id: 'm2',
    user: user('u2', 'Arif Khan'),
    role: roles[2]!,
    venueIds: ['v1'],
    status: 'disabled',
    createdAt: '',
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation(async (path: string) =>
    path.endsWith('/members') ? { members } : { roles },
  );
});

const renderStaff = (perms?: Parameters<typeof ownerValue>[0]) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <OwnerWrap value={ownerValue(perms)}>
        <StaffScreen />
      </OwnerWrap>
    </SafeAreaProvider>,
  );

describe('staff', () => {
  it('lists members with role, venues and disabled badge', async () => {
    await renderStaff();
    expect(await screen.findByText('Nitesh Das (You)')).toBeTruthy();
    expect(screen.getByText('Desk · Arena One')).toBeTruthy();
    expect(screen.getByText('Disabled')).toBeTruthy();
  });

  it('adds a member by phone with the Manager preset', async () => {
    mockPost.mockResolvedValue({});
    await renderStaff();
    await fireEvent.press(await screen.findByRole('button', { name: 'Add' }));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Sumon');
    await fireEvent.changeText(screen.getByLabelText('Phone or email'), '01822556677');
    await fireEvent.press(screen.getByRole('radio', { name: /^Manager/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add member' }));
    await act(async () => {});
    expect(mockPost).toHaveBeenCalledWith('/owners/o1/members', {
      name: 'Sumon',
      phone: '01822556677',
      roleId: 'r2',
      venueIds: 'all',
    });
  });

  it('edits a member: re-enables and removes', async () => {
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);
    await renderStaff();
    await fireEvent.press(await screen.findByRole('button', { name: /^Arif Khan/ }));
    await fireEvent.press(screen.getAllByRole('switch', { name: 'Active' })[0]!);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await act(async () => {});
    expect(mockPatch).toHaveBeenCalledWith('/owners/o1/members/m2', { status: 'active' });

    await fireEvent.press(await screen.findByRole('button', { name: /^Arif Khan/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Remove from team' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Remove member' }));
    await act(async () => {});
    expect(mockDelete).toHaveBeenCalledWith('/owners/o1/members/m2');
  });

  it('hides everything without staff.manage', async () => {
    await renderStaff({ perms: SYSTEM_ROLES.manager });
    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
