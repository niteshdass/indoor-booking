import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SPORTS } from '@booking/shared';
import type { OwnerTurf, OwnerVenue, Permission } from '../../../src/owner/types';
import VenuesScreen from '../../../app/owner/[ownerId]/venues';
import VenueScreen from '../../../app/owner/[ownerId]/venue/[venueId]/index';
import CourtScreen from '../../../app/owner/[ownerId]/venue/[venueId]/court/[turfId]';
import { OwnerWrap, ownerValue, venue as baseVenue } from '../ownerFixture';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => {
      cb();
    }, [cb]);
  },
}));

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockPut = jest.fn();
jest.mock('../../../src/lib/api', () => ({
  ...jest.requireActual('../../../src/lib/api'),
  apiGet: (...a: unknown[]) => mockGet(...a),
  apiPost: (...a: unknown[]) => mockPost(...a),
  apiPatch: (...a: unknown[]) => mockPatch(...a),
  apiPut: (...a: unknown[]) => mockPut(...a),
}));

const open = { open: '06:00', close: '23:00' };
const venue: OwnerVenue = {
  ...baseVenue,
  effectiveSettings: { ...baseVenue.effectiveSettings, hours: { mon: open, tue: open, wed: open, thu: open, fri: open, sat: open, sun: open } } as OwnerVenue['effectiveSettings'],
};
const turf: OwnerTurf = {
  id: 't1',
  venueId: 'v1',
  name: 'Court A',
  sports: ['futsal'],
  indoor: true,
  slotLengthMin: 60,
  active: true,
  settings: {},
  pricing: { base: 90000, rules: [{ days: ['sat'], from: '18:00', to: '22:00', price: 120000 }] } as unknown as OwnerTurf['pricing'],
  effectiveSettings: {} as OwnerTurf['effectiveSettings'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation(async (path: string) => {
    if (path === '/sports') return { sports: [...SPORTS] };
    if (path === '/owners/o1/venues/v1/turfs') return { turfs: [turf] };
    if (path === '/owners/o1/venues/v1/turfs/t1') return { turf };
    throw new Error(`unexpected ${path}`);
  });
});

const show = async (el: React.ReactElement, perms?: readonly Permission[]) => {
  await render(<OwnerWrap value={ownerValue({ venues: [venue], ...(perms ? { perms } : {}) })}>{el}</OwnerWrap>);
  await act(async () => {});
};

describe('venues list', () => {
  it('shows each venue with its court count and opens it', async () => {
    await show(<VenuesScreen />);
    expect(screen.getByText('Arena One')).toBeTruthy();
    expect(screen.getByText(/1 court/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Arena One/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/owner/o1/venue/v1');
  });
});

describe('venue detail', () => {
  beforeEach(() => {
    mockParams = { venueId: 'v1' };
  });

  it('hides the venue from players with PATCH published', async () => {
    mockPatch.mockResolvedValue({ venue: { ...venue, published: false } });
    await show(<VenueScreen />);
    expect(screen.getByText('Court A')).toBeTruthy();
    await fireEvent.press(screen.getByRole('switch', { name: /Show to players/ }));
    await act(async () => {});
    expect(mockPatch).toHaveBeenCalledWith('/owners/o1/venues/v1', { published: false });
  });

  it('hides publishing and adding courts without the permissions', async () => {
    await show(<VenueScreen />, ['booking.view']);
    expect(screen.queryByRole('switch', { name: /Show to players/ })).toBeNull();
    expect(screen.queryByText('Add court')).toBeNull();
  });
});

describe('court editor', () => {
  it('adds a court and its base price', async () => {
    mockParams = { venueId: 'v1', turfId: 'new' };
    mockPost.mockResolvedValue({ turf: { ...turf, id: 't9', pricing: null } });
    mockPut.mockResolvedValue({ pricing: { base: 80000, rules: [] } });
    await show(<CourtScreen />);
    await fireEvent.changeText(screen.getByLabelText('Turf name'), 'Court B');
    await fireEvent.press(screen.getByRole('checkbox', { name: /Cricket/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Longer slot' }));
    await fireEvent.changeText(screen.getByLabelText('Price per slot (BDT)'), '800');
    await fireEvent.press(screen.getByRole('button', { name: 'Add court' }));
    await act(async () => {});
    expect(mockPost).toHaveBeenCalledWith('/owners/o1/venues/v1/turfs', { name: 'Court B', sports: ['cricket'], indoor: false, slotLengthMin: 75 });
    expect(mockPut).toHaveBeenCalledWith('/owners/o1/venues/v1/turfs/t9/pricing', { base: 80000, rules: [] });
    expect(mockRouter.replace).toHaveBeenCalledWith('/owner/o1/venue/v1/court/t9');
  });

  it('sends only the changed fields and keeps the price rules', async () => {
    mockParams = { venueId: 'v1', turfId: 't1' };
    mockPatch.mockResolvedValue({ turf: { ...turf, name: 'Court Z' } });
    mockPut.mockResolvedValue({ pricing: { base: 100000, rules: turf.pricing!.rules } });
    await show(<CourtScreen />);
    await fireEvent.changeText(screen.getByLabelText('Turf name'), 'Court Z');
    await fireEvent.changeText(screen.getByLabelText('Price per slot (BDT)'), '1000');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await act(async () => {});
    expect(mockPatch).toHaveBeenCalledWith('/owners/o1/venues/v1/turfs/t1', { name: 'Court Z' });
    expect(mockPut).toHaveBeenCalledWith('/owners/o1/venues/v1/turfs/t1/pricing', { base: 100000, rules: turf.pricing!.rules });
  });

  it('is read-only without turf.manage and pricing.edit', async () => {
    mockParams = { venueId: 'v1', turfId: 't1' };
    await show(<CourtScreen />, ['booking.view']);
    expect(screen.getByText('Court A')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });
});
