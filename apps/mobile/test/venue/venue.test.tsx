import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { ApiError } from '../../src/lib/api';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import VenueScreen from '../../app/venue/[slug]';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
let mockParams: Record<string, string> = { slug: 'arena-one' };

const mockGet = jest.fn();
jest.mock('../../src/lib/api', () => {
  const actual = jest.requireActual('../../src/lib/api');
  return { ...actual, apiGet: (...a: unknown[]) => mockGet(...a) };
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
  rating: { average: 4.5, count: 2 },
  turfs: [
    { id: 't1', name: 'Court A', sports: ['futsal'], indoor: true, slotLengthMin: 60 },
    { id: 't2', name: 'Court B', sports: ['futsal'], indoor: false, slotLengthMin: 60 },
  ],
};

const HOUR = 3_600_000;
const T0 = Date.parse('2026-11-05T13:00:00Z'); // 19:00 in Dhaka (UTC+6)
const slot = (i: number, status = 'available', price: number | null = 150000) => ({
  startAt: new Date(T0 + i * HOUR).toISOString(),
  endAt: new Date(T0 + (i + 1) * HOUR).toISOString(),
  localStart: 'WRONG',
  localEnd: 'WRONG',
  price,
  status,
});
const openDay = (date: string, slots = [slot(0), slot(1, 'booked'), slot(2), slot(3), slot(5)]) => ({
  day: { businessDate: date, currency: 'BDT', status: 'open', slots },
});

/** 2026-11-05 13:00Z is Dhaka evening; "today" is pinned so the date strip starts that day. */
function serve(slots: (turf: string, date: string) => unknown = (_t, d) => openDay(d)) {
  mockGet.mockImplementation(async (path: string) => {
    if (path === '/venues/arena-one') return { venue };
    if (path.startsWith('/venues/arena-one/reviews')) return { reviews: [], nextBefore: null };
    const m = /turfs\/(\w+)\/slots\?date=([\d-]+)/.exec(path);
    if (m) {
      const out = slots(m[1]!, m[2]!);
      if (out instanceof Error) throw out;
      return out;
    }
    throw new Error(`unexpected ${path}`);
  });
}

const renderVenue = () =>
  render(
    <ThemeProvider>
      <VenueScreen />
    </ThemeProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { slug: 'arena-one' };
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(new Date('2026-11-05T10:00:00Z')); // 16:00 in Dhaka, still 5 Nov
});
afterEach(() => jest.useRealTimers());

describe('venue screen', () => {
  it('a turfId param preselects that court (Book again)', async () => {
    mockParams = { slug: 'arena-one', turfId: 't2' };
    serve();
    await renderVenue();
    await screen.findByRole('button', { name: /^19:00/ });
    expect(screen.getByRole('tab', { name: /Court B/ }).props.accessibilityState).toMatchObject({ selected: true });
    expect(mockGet.mock.calls.some((c) => /turfs\/t2\/slots/.test(String(c[0])))).toBe(true);
    expect(mockGet.mock.calls.some((c) => /turfs\/t1\/slots/.test(String(c[0])))).toBe(false);
  });

  it('times render in the venue timezone', async () => {
    // The test process runs as UTC (test/globalSetup.js), so device-local formatting would say 13:00.
    expect(new Date(T0).getHours()).toBe(13);
    serve();
    await renderVenue();
    expect(await screen.findByRole('button', { name: /^19:00/ })).toBeTruthy();
    expect(screen.queryByText('13:00')).toBeNull();
    expect(screen.queryByText('WRONG')).toBeNull();
  });

  it('taken slots are not selectable and say "Booked" in text', async () => {
    serve();
    await renderVenue();
    const booked = await screen.findByRole('button', { name: '20:00, Booked' });
    expect(within(booked).getByText('Booked')).toBeTruthy();
    expect(booked.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(booked);
    expect(screen.queryByText(/1 slot/)).toBeNull();
  });

  it('selecting non-adjacent slots follows the shared selection rule', async () => {
    serve();
    await renderVenue();
    await fireEvent.press(await screen.findByRole('button', { name: /^19:00/ }));
    await fireEvent.press(await screen.findByRole('button', { name: /^21:00/ })); // 20:00 is booked: not adjacent
    expect(screen.getByRole('button', { name: /^21:00/ }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('button', { name: /^19:00/ }).props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(screen.getByRole('button', { name: /^22:00/ })); // adjacent: extends the run
    expect(screen.getByRole('button', { name: /^21:00/ }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('button', { name: /^22:00/ }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText('2 slots')).toBeTruthy();
  });

  it('changing date clears the selection', async () => {
    serve();
    await renderVenue();
    await fireEvent.press(await screen.findByRole('button', { name: /^19:00/ }));
    expect(screen.getByText('1 slot')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: /Nov 6/ }));
    expect(await screen.findByRole('button', { name: /^19:00/ })).toBeTruthy();
    expect(screen.queryByText('1 slot')).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('past times are left out; a day with only past times says so', async () => {
    serve((_t, d) => openDay(d, d === '2026-11-05' ? [slot(-3, 'past'), slot(-2, 'past')] : [slot(-1, 'past'), slot(0)]));
    await renderVenue();
    expect(await screen.findByText('No more times today. Pick another day.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: /Nov 6/ }));
    expect(await screen.findByRole('button', { name: /^19:00/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^18:00/ })).toBeNull();
    expect(screen.queryByText('Past')).toBeNull();
  });

  it('closed day shows the closed message', async () => {
    serve((_t, d) => ({ day: { businessDate: d, currency: 'BDT', status: 'closed', slots: [] } }));
    await renderVenue();
    expect(await screen.findByText('Closed on this day.')).toBeTruthy();
  });

  it('continue goes to checkout with turfId, date and comma-joined startAts', async () => {
    serve();
    await renderVenue();
    await fireEvent.press(await screen.findByRole('button', { name: /^21:00/ }));
    await fireEvent.press(screen.getByRole('button', { name: /^22:00/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/venue/[slug]/checkout',
      params: {
        slug: 'arena-one',
        turfId: 't1',
        date: '2026-11-05',
        startAts: [new Date(T0 + 2 * HOUR).toISOString(), new Date(T0 + 3 * HOUR).toISOString()].join(','),
      },
    });
  });

  it('switching court loads that court and clears the selection', async () => {
    serve();
    await renderVenue();
    await fireEvent.press(await screen.findByRole('button', { name: /^19:00/ }));
    await fireEvent.press(screen.getByRole('tab', { name: /Court B/ }));
    await screen.findByRole('button', { name: /^19:00/ });
    expect(mockGet.mock.calls.some((c) => String(c[0]).includes('/turfs/t2/slots?date=2026-11-05'))).toBe(true);
    expect(screen.queryByText('1 slot')).toBeNull();
  });

  it('slot load failure shows the error with retry', async () => {
    let fail = true;
    serve((_t, d) => (fail ? new ApiError(500, 'internal', 'x') : openDay(d)));
    await renderVenue();
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /^19:00/ })).toBeTruthy();
  });

  it('shows the venue as not found on 404', async () => {
    mockGet.mockImplementation(async () => {
      throw new ApiError(404, 'not_found', 'x');
    });
    await renderVenue();
    expect(await screen.findByText(/couldn't find/)).toBeTruthy();
  });
});
