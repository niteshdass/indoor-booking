import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SYSTEM_ROLES } from '@booking/shared';
import WalkInScreen from '../../../app/owner/[ownerId]/walkin';
import { OwnerWrap, ownerValue } from '../ownerFixture';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-crypto', () => ({ randomUUID: () => 'key-1' }));
jest.mock('expo-router', () => ({ get router() { return mockRouter; }, useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../src/lib/api', () => {
  const actual = jest.requireActual('../../../src/lib/api');
  return { ...actual, apiGet: (...a: unknown[]) => mockGet(...a), apiPost: (...a: unknown[]) => mockPost(...a) };
});

const DATE = '2030-01-10';
const start = (d: string) => `${d}T12:00:00.000Z`;
const turf = { id: 't1', venueId: 'v1', name: 'Court A', sports: ['football'], indoor: true, slotLengthMin: 60, active: true, settings: {}, pricing: null, effectiveSettings: {}, createdAt: '' };

function day(d: string) {
  return {
    businessDate: d,
    currency: 'BDT',
    closed: false,
    closedReason: null,
    inWindow: true,
    slots: [{ startAt: start(d), endAt: `${d}T13:00:00.000Z`, localStart: '18:00', localEnd: '19:00', price: 150000, status: 'available', source: 'hours' }],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { date: DATE, start: start(DATE) };
  mockGet.mockImplementation(async (path: string) => {
    if (path.endsWith('/turfs')) return { turfs: [turf] };
    if (path.includes('/slots?date=')) return { day: day(path.split('date=')[1]!) };
    if (path.endsWith('/addons')) return { currency: 'BDT', addons: [] };
    if (path.includes('/customers')) return { customers: [] };
    throw new Error(`unexpected ${path}`);
  });
});

const renderWalkIn = (perms?: Parameters<typeof ownerValue>[0]) =>
  render(
    <OwnerWrap value={ownerValue(perms)}>
      <WalkInScreen />
    </OwnerWrap>,
  );

async function toStepTwo() {
  await renderWalkIn();
  expect(await screen.findByText('Court A')).toBeTruthy();
  const next = screen.getByRole('button', { name: 'Continue' });
  await waitFor(() => expect(next).toBeEnabled());
  await fireEvent.press(next);
  await fireEvent.changeText(await screen.findByLabelText('Customer name'), '  Rafi ');
  await fireEvent.changeText(screen.getByLabelText(/Phone number/), '1712345678');
}

describe('walk-in', () => {
  it('hides the flow without booking.create', async () => {
    await renderWalkIn({ perms: ['booking.view'] });
    expect(await screen.findByText("You can't create bookings in this team.")).toBeTruthy();
    expect(screen.queryByText('Court A')).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('shows the courts, the picked slot and the total', async () => {
    await renderWalkIn();
    expect(await screen.findByText('Court A')).toBeTruthy();
    expect(await screen.findByText(/1 booking · 1 slot/)).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith(`/owners/o1/venues/v1/turfs/t1/slots?date=${DATE}`);
  });

  it('creates the booking with the web body and opens it', async () => {
    mockPost.mockResolvedValue({ booking: { id: 'b1' } });
    await toStepTwo();
    await fireEvent.press(screen.getByRole('button', { name: 'Create booking' }));
    await act(async () => {});
    expect(mockPost).toHaveBeenCalledWith('/owners/o1/venues/v1/turfs/t1/bookings', {
      date: DATE,
      startAts: [start(DATE)],
      addons: [],
      customer: { name: 'Rafi', phone: '+8801712345678' },
      payment: { method: 'unpaid' },
    }, { 'Idempotency-Key': 'key-1' });
    expect(mockRouter.replace).toHaveBeenCalledWith('/owner/o1/booking/b1');
  });

  it('does not send without a phone', async () => {
    await toStepTwo();
    await fireEvent.changeText(screen.getByLabelText(/Phone number/), '');
    await fireEvent.press(screen.getByRole('button', { name: 'Create booking' }));
    await act(async () => {});
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows the payment link sheet after a link booking', async () => {
    mockPost.mockResolvedValue({ booking: { id: 'b1' }, payment: { id: 'p1', amount: 150000, currency: 'BDT', url: 'https://pay.example/x' } });
    await toStepTwo();
    await fireEvent.press(screen.getByRole('radio', { name: 'Send a payment link' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create booking' }));
    await act(async () => {});
    expect(mockPost.mock.calls[0][1].payment).toEqual({ method: 'link' });
    expect(await screen.findByText('Payment link ready')).toBeTruthy();
    expect(screen.getByText('https://pay.example/x')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Open booking' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/owner/o1/booking/b1');
  });

  it('offers cash only with payment.mark_cash', async () => {
    await toStepTwo();
    expect(screen.getByRole('radio', { name: 'Cash received now' })).toBeTruthy();
    await screen.unmount();
    await renderWalkIn({ perms: SYSTEM_ROLES.staff.filter((p) => p !== 'payment.mark_cash') });
    const next = await screen.findByRole('button', { name: 'Continue' });
    await waitFor(() => expect(next).toBeEnabled());
    await fireEvent.press(next);
    expect(await screen.findByRole('radio', { name: 'Send a payment link' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Cash received now' })).toBeNull();
  });
});
