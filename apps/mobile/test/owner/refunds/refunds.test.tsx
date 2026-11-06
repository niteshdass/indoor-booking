import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SYSTEM_ROLES } from '@booking/shared';
import OwnerRefundsScreen from '../../../app/owner/[ownerId]/refunds';
import type { RefundToSend } from '../../../src/owner/refunds/api';
import { OwnerWrap, ownerValue } from '../ownerFixture';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ get router() { return mockRouter; }, useRouter: () => mockRouter, useLocalSearchParams: () => ({ ownerId: 'o1' }) }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../src/lib/api', () => {
  const actual = jest.requireActual('../../../src/lib/api');
  return { ...actual, apiGet: (...a: unknown[]) => mockGet(...a), apiPost: (...a: unknown[]) => mockPost(...a) };
});

const refund = (id: string, over: Partial<RefundToSend> = {}): RefundToSend => ({
  id,
  paymentId: `p${id}`,
  method: 'wallet',
  amount: 300000,
  currency: 'BDT',
  reason: 'cancellation',
  ruleApplied: null,
  status: 'pending',
  failureCode: null,
  retryOf: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  trxId: null,
  provider: 'bkash',
  sendTo: '+8801812345678',
  booking: {
    id: `b${id}`,
    reference: `REF${id}`,
    businessDate: '2026-11-03',
    venueId: 'v1',
    turf: { name: 'Court A' },
    customer: { name: 'Rafi', phone: '+8801812345678' },
  },
  ...over,
});

const FIRST = '/owners/o1/refunds?method=wallet&status=pending';

const show = async (perms?: readonly string[]) => {
  await render(
    <OwnerWrap value={ownerValue(perms ? { perms: perms as never } : {})}>
      <OwnerRefundsScreen />
    </OwnerWrap>,
  );
  await act(async () => {});
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('refunds to send', () => {
  it('lists pending wallet refunds with amount, provider, number and booking', async () => {
    mockGet.mockResolvedValue({ refunds: [refund('1')], nextBefore: null });
    await show();
    expect(mockGet).toHaveBeenCalledWith(FIRST);
    expect(screen.getByText(/Send .* back to .* by bKash/)).toBeTruthy();
    expect(screen.getByText(/Rafi · REF1/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Open booking REF1/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/owner/o1/booking/b1');
  });

  it('marks a refund sent with the TrxID, then reloads', async () => {
    mockGet.mockResolvedValueOnce({ refunds: [refund('1')], nextBefore: null }).mockResolvedValueOnce({ refunds: [], nextBefore: null });
    mockPost.mockResolvedValue({ refund: { ...refund('1'), status: 'succeeded' } });
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Mark sent' }));
    await fireEvent.changeText(screen.getByLabelText('Transaction ID of the refund'), ' 8k2m3n4p5q ');
    const buttons = screen.getAllByRole('button', { name: 'Mark sent' });
    await fireEvent.press(buttons[buttons.length - 1]!);
    await act(async () => {});
    expect(mockPost).toHaveBeenCalledWith('/owners/o1/refunds/1/mark-sent', { trxId: '8K2M3N4P5Q' });
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(screen.getByText("No refunds to send. You're all caught up.")).toBeTruthy();
  });

  it('shows the empty state', async () => {
    mockGet.mockResolvedValue({ refunds: [], nextBefore: null });
    await show();
    expect(screen.getByText("No refunds to send. You're all caught up.")).toBeTruthy();
  });

  it('pages with Show more', async () => {
    mockGet
      .mockResolvedValueOnce({ refunds: [refund('2')], nextBefore: '2' })
      .mockResolvedValueOnce({ refunds: [refund('1')], nextBefore: null });
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Show more' }));
    await act(async () => {});
    expect(mockGet).toHaveBeenLastCalledWith(`${FIRST}&before=2`);
    expect(screen.getByText(/REF1/)).toBeTruthy();
    expect(screen.getByText(/REF2/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('is gated on payment.verify', async () => {
    await show(SYSTEM_ROLES.staff);
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.getByText('Only members who check payments can send refunds.')).toBeTruthy();
  });
});
