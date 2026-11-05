import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SYSTEM_ROLES } from '@booking/shared';
import BookingRoute from '../../../app/owner/[ownerId]/booking/[id]';
import type { BookingDetail, OwnerBooking, RefundJson } from '../../../src/owner/types';
import { OwnerWrap, ownerValue } from '../ownerFixture';
import { makeBooking } from './fixtures';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ get router() { return mockRouter; }, useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: 'b1', ownerId: 'o1' }) }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../src/lib/api', () => {
  const actual = jest.requireActual('../../../src/lib/api');
  return { ...actual, apiGet: (...a: unknown[]) => mockGet(...a), apiPost: (...a: unknown[]) => mockPost(...a) };
});

let detail: BookingDetail;
const serve = (booking: OwnerBooking, refunds: RefundJson[] = []) => {
  detail = { booking, payments: [], refunds };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation(async (path: string) => {
    if (path === '/owners/o1/bookings/b1') return detail;
    if (path.endsWith('/turfs')) return { turfs: [] };
    throw new Error(`unexpected ${path}`);
  });
});

const renderDetail = (over?: Parameters<typeof ownerValue>[0]) =>
  render(
    <OwnerWrap value={ownerValue(over)}>
      <BookingRoute />
    </OwnerWrap>,
  );

describe('booking detail', () => {
  it('shows reference, customer and court', async () => {
    serve(makeBooking('b1', 'Rafi'));
    await renderDetail();
    expect(await screen.findByText('BK-b1')).toBeTruthy();
    expect(screen.getAllByText('Rafi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Court A').length).toBeGreaterThan(0);
    expect(mockGet).toHaveBeenCalledWith('/owners/o1/bookings/b1');
  });

  it('confirms a pending booking with POST …/confirm', async () => {
    const b = makeBooking('b1', 'Rafi', { status: 'pending' });
    serve(b);
    mockPost.mockResolvedValue({ booking: { ...b, status: 'confirmed' } });
    await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirm' }));
    await act(async () => {});
    expect(mockPost).toHaveBeenCalledWith('/owners/o1/bookings/b1/confirm', {});
  });

  it('records the full cash amount with an empty body', async () => {
    const b = makeBooking('b1', 'Rafi');
    serve(b);
    mockPost.mockResolvedValue({ booking: { ...b, amountPaid: b.total, paymentStatus: 'paid' } });
    await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Mark cash paid' }));
    await fireEvent.changeText(await screen.findByLabelText('Amount received'), '500');
    const save = await screen.findByRole('button', { name: /Save .*500/ });
    await fireEvent.press(save);
    await act(async () => {});
    expect(mockPost).toHaveBeenCalledWith('/owners/o1/bookings/b1/payments/cash', { amount: 50000 });
  });

  it('marks a wallet refund as sent with its trxId', async () => {
    const refund = {
      id: 'r1',
      paymentId: 'p1',
      method: 'wallet',
      amount: 50000,
      currency: 'BDT',
      reason: 'cancellation',
      ruleApplied: null,
      status: 'pending',
      failureCode: null,
      retryOf: null,
      createdAt: new Date().toISOString(),
      trxId: null,
      provider: 'bkash',
      sendTo: '+8801711111111',
    } as RefundJson;
    serve(makeBooking('b1', 'Rafi', { status: 'cancelled', amountPaid: 50000 }), [refund]);
    mockPost.mockResolvedValue({ refund: { ...refund, status: 'succeeded', trxId: 'ABCD1234' } });
    await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Mark sent' }));
    await fireEvent.changeText(await screen.findByLabelText('Transaction ID of the refund'), 'abcd1234');
    const buttons = screen.getAllByRole('button', { name: 'Mark sent' });
    await fireEvent.press(buttons[buttons.length - 1]!);
    await act(async () => {});
    expect(mockPost).toHaveBeenCalledWith('/owners/o1/refunds/r1/mark-sent', { trxId: 'ABCD1234' });
  });

  it('hides confirm, verify and refund sending from staff', async () => {
    serve(
      makeBooking('b1', 'Rafi', {
        status: 'pending',
        manualPayment: { id: 'm1', provider: 'bkash', trxId: 'TRX12345', amount: 150000, senderNumber: null, status: 'pending', submittedAt: new Date().toISOString() },
      }),
    );
    await renderDetail({ perms: SYSTEM_ROLES.staff });
    expect(await screen.findByText('BK-b1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verify payment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });
});
