import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { SearchResult } from '@booking/shared';
import { ApiError } from '../../src/lib/api';
import { __resetLocationDecision } from '../../src/search/useNearMe';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import FindScreen from '../../app/(tabs)/index';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({}) }));

const mockGet = jest.fn();
jest.mock('../../src/lib/api', () => {
  const actual = jest.requireActual('../../src/lib/api');
  return { ...actual, apiGet: (...a: unknown[]) => mockGet(...a) };
});

const mockLocation = {
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
};
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...a: unknown[]) => mockLocation.getForegroundPermissionsAsync(...a),
  requestForegroundPermissionsAsync: (...a: unknown[]) => mockLocation.requestForegroundPermissionsAsync(...a),
  getCurrentPositionAsync: (...a: unknown[]) => mockLocation.getCurrentPositionAsync(...a),
  Accuracy: { Balanced: 3 },
}));

const venue = (n: number, over: Partial<SearchResult> = {}): SearchResult => ({
  slug: `venue-${n}`,
  name: `Venue ${n}`,
  address: `${n} Main Rd`,
  city: 'Dhaka',
  country: 'BD',
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
  location: { lat: 23.8, lng: 90.4 },
  photo: null,
  sports: ['futsal'],
  distanceMeters: null,
  date: '2026-11-03',
  fromPrice: 120000,
  nextFreeSlot: null,
  freeTimes: [],
  freeTimeCount: 0,
  rating: null,
  ...over,
});

/** Routes mocked GETs: /sports, and /search by its query string. */
function serve(search: (query: URLSearchParams) => unknown) {
  mockGet.mockImplementation(async (path: string) => {
    if (path === '/sports') return { sports: ['futsal', 'cricket'] };
    const out = search(new URLSearchParams(path.split('?')[1]));
    if (out instanceof Error) throw out;
    return out;
  });
}
const searches = () => mockGet.mock.calls.map((c) => c[0] as string).filter((p) => p.startsWith('/search'));
const lastSearch = () => new URLSearchParams(searches().at(-1)!.split('?')[1]);

const renderFind = () =>
  render(
    <ThemeProvider>
      <FindScreen />
    </ThemeProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  __resetLocationDecision();
  mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
});

describe('find tab', () => {
  it('shows results for the chosen sport', async () => {
    serve((q) => ({ results: q.get('sport') === 'cricket' ? [venue(2, { sports: ['cricket'] })] : [venue(1)], nextCursor: null }));
    await renderFind();
    expect(await screen.findByText('Venue 1')).toBeTruthy();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sport: Any sport' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Cricket' }));
    expect(await screen.findByText('Venue 2')).toBeTruthy();
    expect(screen.queryByText('Venue 1')).toBeNull();
    expect(lastSearch().get('sport')).toBe('cricket');
    expect(screen.getByRole('button', { name: 'Sport: Cricket' })).toBeTruthy();
  });

  it('opens the venue when a card is tapped', async () => {
    serve(() => ({ results: [venue(1)], nextCursor: null }));
    await renderFind();
    await fireEvent.press(await screen.findByText('Venue 1'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/venue/[slug]', params: { slug: 'venue-1' } });
  });

  it('load more appends the next page', async () => {
    serve((q) =>
      q.get('cursor') === '0'
        ? { results: Array.from({ length: 20 }, (_, i) => venue(i + 1)), nextCursor: 20 }
        : { results: [venue(21)], nextCursor: null },
    );
    await renderFind();
    await screen.findByText('Venue 1');
    await fireEvent.press(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Venue 21')).toBeTruthy();
    expect(screen.getByText('Venue 1')).toBeTruthy();
    expect(lastSearch().get('cursor')).toBe('20');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('searches near the player when location is allowed', async () => {
    serve(() => ({ results: [venue(1, { distanceMeters: 1500 })], nextCursor: null }));
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
    mockLocation.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 23.81, longitude: 90.41 } });
    await renderFind();
    await fireEvent.press(await screen.findByRole('button', { name: 'Use my location' }));
    expect(await screen.findByText('Using your location')).toBeTruthy();
    expect(lastSearch().get('lat')).toBe('23.81');
    expect(lastSearch().get('lng')).toBe('90.41');
  });

  it('location denied falls back to the text search', async () => {
    serve((q) => ({ results: [venue(q.get('q') ? 7 : 1)], nextCursor: null }));
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: false });
    await renderFind();
    await fireEvent.press(await screen.findByRole('button', { name: 'Use my location' }));
    expect(await screen.findByText('Location is off. Search by venue name or area instead.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Venue or area'), 'Dhaka');
    await fireEvent(screen.getByLabelText('Venue or area'), 'submitEditing');
    expect(await screen.findByText('Venue 7')).toBeTruthy();
    expect(lastSearch().get('q')).toBe('Dhaka');
    expect(lastSearch().get('lat')).toBeNull();
    // It does not ask again.
    expect(screen.queryByRole('button', { name: 'Use my location' })).toBeNull();
    expect(mockLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('does not prompt when the system already blocked location', async () => {
    serve(() => ({ results: [venue(1)], nextCursor: null }));
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: false });
    await renderFind();
    expect(await screen.findByText('Location is off. Search by venue name or area instead.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use my location' })).toBeNull();
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('searches by name or area once typing settles, and clear drops the text', async () => {
    serve((q) => ({ results: [venue(q.get('q') ? 5 : 1)], nextCursor: null }));
    await renderFind();
    await screen.findByText('Venue 1');
    await fireEvent.changeText(screen.getByLabelText('Venue or area'), '  Golden Mirpur ');
    expect(await screen.findByText('Venue 5', {}, { timeout: 2000 })).toBeTruthy();
    expect(lastSearch().get('q')).toBe('Golden Mirpur');
    await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByText('Venue 1')).toBeTruthy();
    expect(lastSearch().get('q')).toBeNull();
  });

  it('clears the location from its chip', async () => {
    serve((q) => ({ results: [venue(q.get('lat') ? 7 : 1)], nextCursor: null }));
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
    mockLocation.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 23.81, longitude: 90.41 } });
    await renderFind();
    await fireEvent.press(await screen.findByRole('button', { name: 'Use my location' }));
    expect(await screen.findByText('Venue 7')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Clear location' }));
    expect(await screen.findByText('Venue 1')).toBeTruthy();
    expect(lastSearch().get('lat')).toBeNull();
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeTruthy();
  });

  it('empty result shows the translated empty state', async () => {
    serve(() => ({ results: [], nextCursor: null }));
    await renderFind();
    expect(await screen.findByText('No turfs found')).toBeTruthy();
    expect(screen.getByText('Try another date or sport, or loosen the filters.')).toBeTruthy();
  });

  it('network error shows retry', async () => {
    let fail = true;
    serve(() => (fail ? new ApiError(0, 'network_error', 'offline') : { results: [venue(1)], nextCursor: null }));
    await renderFind();
    expect(await screen.findByText(/connection/i)).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => {});
    expect(await screen.findByText('Venue 1')).toBeTruthy();
  });

  it('points to the text search when the location fix fails, and keeps retry', async () => {
    serve(() => ({ results: [venue(1)], nextCursor: null }));
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
    mockLocation.getCurrentPositionAsync.mockRejectedValue(new Error('no fix'));
    await renderFind();
    await fireEvent.press(await screen.findByRole('button', { name: 'Use my location' }));
    expect(await screen.findByText("We couldn't get your location. Search by venue name or area instead.")).toBeTruthy();
    expect(screen.getByLabelText('Venue or area')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeTruthy();
  });

  it('follows an empty page that still has a cursor', async () => {
    serve((q) =>
      q.get('cursor') === '0'
        ? { results: [], nextCursor: 20 }
        : { results: [venue(3)], nextCursor: null },
    );
    await renderFind();
    expect(await screen.findByText('Venue 3')).toBeTruthy();
    expect(searches()).toHaveLength(2);
    expect(screen.queryByText('No turfs found')).toBeNull();
  });

  it('does not show the empty state next to load more when follow gives up', async () => {
    serve((q) => ({ results: [], nextCursor: Number(q.get('cursor')) + 20 }));
    await renderFind();
    expect(await screen.findByRole('button', { name: 'Load more' })).toBeTruthy();
    expect(screen.queryByText('No turfs found')).toBeNull();
    expect(searches()).toHaveLength(11);
  });

  it('drops a stale response after the criteria changed', async () => {
    let releaseFirst: (v: unknown) => void = () => undefined;
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/sports') return { sports: ['futsal', 'cricket'] };
      if (!path.includes('sport=')) return new Promise((r) => (releaseFirst = r));
      return { results: [venue(2)], nextCursor: null };
    });
    await renderFind();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sport: Any sport' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Cricket' }));
    expect(await screen.findByText('Venue 2')).toBeTruthy();
    await act(async () => releaseFirst({ results: [venue(1)], nextCursor: null }));
    expect(screen.getByText('Venue 2')).toBeTruthy();
    expect(screen.queryByText('Venue 1')).toBeNull();
  });

  it('retries a failed load more and keeps the loaded venues', async () => {
    let fail = true;
    serve((q) => {
      if (q.get('cursor') === '0') return { results: Array.from({ length: 20 }, (_, i) => venue(i + 1)), nextCursor: 20 };
      return fail ? new ApiError(0, 'network_error', 'offline') : { results: [venue(21)], nextCursor: null };
    });
    await renderFind();
    await fireEvent.press(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText(/connection/i)).toBeTruthy();
    expect(screen.getByText('Venue 1')).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Venue 21')).toBeTruthy();
    expect(screen.getByText('Venue 1')).toBeTruthy();
  });
});
