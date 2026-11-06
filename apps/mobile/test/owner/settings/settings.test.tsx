import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { Permission } from '../../../src/owner/types';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DEFAULT_OWNER_SETTINGS, SYSTEM_ROLES } from '@booking/shared';
import SettingsScreen from '../../../app/owner/[ownerId]/settings';
import { OwnerWrap, ownerValue, venue } from '../ownerFixture';

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
const mockPatch = jest.fn();
jest.mock('../../../src/lib/api', () => {
  const actual = jest.requireActual('../../../src/lib/api');
  return {
    ...actual,
    apiGet: (...a: unknown[]) => mockGet(...a),
    apiPatch: (...a: unknown[]) => mockPatch(...a),
  };
});

const ownerSettings = {
  ...DEFAULT_OWNER_SETTINGS,
  bookingWindowDays: 14,
  refundRules: [{ minHoursBefore: 24, percent: 100 }],
  paymentPolicy: { type: 'partial_percent' as const, percent: 25 },
};
const arena = { ...venue, settings: {}, effectiveSettings: ownerSettings };

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ settings: ownerSettings });
});

const renderSettings = (perms?: readonly Permission[]) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <OwnerWrap value={ownerValue({ perms, venues: [arena] })}>
        <SettingsScreen />
      </OwnerWrap>
    </SafeAreaProvider>,
  );

describe('settings', () => {
  it('shows the team settings rows', async () => {
    await renderSettings();
    expect(await screen.findByText('Book up to 14 days ahead')).toBeTruthy();
    expect(screen.getByText('24 h+ 100%')).toBeTruthy();
    expect(screen.getByText('25% online, rest at the desk')).toBeTruthy();
    expect(screen.getByText('bKash')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/owners/o1/settings');
  });

  it('saves a team rule change with only what changed', async () => {
    mockPatch.mockResolvedValue({ settings: { ...ownerSettings, bookingWindowDays: 30 } });
    await renderSettings();
    await fireEvent.press(await screen.findByRole('button', { name: /^Rules/ }));
    await fireEvent.changeText(screen.getByLabelText('Days ahead players can book'), '30');
    await fireEvent.press(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});
    expect(mockPatch).toHaveBeenCalledWith('/owners/o1/settings', { bookingWindowDays: 30 });
    expect(screen.getByText('Book up to 30 days ahead')).toBeTruthy();
  });

  it('overrides a venue under { settings }', async () => {
    mockPatch.mockResolvedValue({ venue: { ...arena, settings: { bookingWindowDays: 7 } } });
    await renderSettings();
    await fireEvent.press(await screen.findByRole('button', { name: 'Arena One' }));
    expect(screen.getByText('Team default · Book up to 14 days ahead')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Rules/ }));
    await fireEvent.press(screen.getAllByRole('switch', { name: 'Use team default' })[0]!);
    await fireEvent.changeText(screen.getByLabelText('Days ahead players can book'), '7');
    await fireEvent.press(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});
    expect(mockPatch).toHaveBeenCalledWith('/owners/o1/venues/v1', {
      settings: expect.objectContaining({ bookingWindowDays: 7 }),
    });
  });

  it('needs settings.edit', async () => {
    await renderSettings(SYSTEM_ROLES.manager);
    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
