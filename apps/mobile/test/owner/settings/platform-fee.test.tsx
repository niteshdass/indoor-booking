import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { Permission } from '../../../src/owner/types';
import { SYSTEM_ROLES, type OwnerPlatformFeeJson } from '@booking/shared';
import PlatformFeeScreen from '../../../app/owner/[ownerId]/platform-fee';
import { OwnerWrap, ownerValue } from '../ownerFixture';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  router: mockRouter,
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../src/lib/api', () => {
  const actual = jest.requireActual('../../../src/lib/api');
  return { ...actual, apiGet: (...a: unknown[]) => mockGet(...a), apiPost: (...a: unknown[]) => mockPost(...a) };
});

const fee: OwnerPlatformFeeJson = {
  feeActive: true,
  payer: 'owner',
  balances: [
    {
      currency: 'BDT',
      owed: 200000,
      paid: 50000,
      pending: 30000,
      balance: 150000,
      payable: 120000,
    },
  ],
  payouts: [
    {
      id: 'p1',
      ownerId: 'o1',
      currency: 'BDT',
      amount: 50000,
      method: 'bkash',
      trxId: 'TRX123',
      senderNumber: '+8801711000000',
      status: 'confirmed',
      rejectReason: null,
      createdAt: '2026-10-01T10:00:00.000Z',
      reviewedAt: null,
    },
    {
      id: 'p2',
      ownerId: 'o1',
      currency: 'BDT',
      amount: 30000,
      method: 'nagad',
      trxId: 'TRX456',
      senderNumber: null,
      status: 'rejected',
      rejectReason: 'Wrong TrxID',
      createdAt: '2026-10-05T10:00:00.000Z',
      reviewedAt: null,
    },
  ],
  methods: { bkash: null, nagad: null, stripe: null },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue(fee);
});

const renderFee = (perms?: readonly Permission[]) =>
  render(
    <OwnerWrap value={ownerValue({ perms })}>
      <PlatformFeeScreen />
    </OwnerWrap>,
  );

const withWallets: OwnerPlatformFeeJson = {
  ...fee,
  methods: {
    bkash: { provider: 'bkash', number: '01711000111', accountType: 'personal', note: 'Reference: your team name' },
    nagad: { provider: 'nagad', number: '01811000222', accountType: 'merchant' },
    stripe: { publishableKey: 'pk_test' },
  },
};

describe('platform fee', () => {
  it('shows what is owed, the pay-on-web note and the history (card only)', async () => {
    mockGet.mockResolvedValue({ ...fee, methods: { bkash: null, nagad: null, stripe: { publishableKey: 'pk_test' } } });
    await renderFee();
    expect(await screen.findByText(/^You owe /)).toBeTruthy();
    expect(screen.getByText(/^Awaiting check /)).toBeTruthy();
    expect(
      screen.getByText('Paying the fee is on the web for now. Open the owner portal to pay.'),
    ).toBeTruthy();
    expect(screen.getByText('Paid')).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.getByText(/Wrong TrxID/)).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/owners/o1/platform-fee');
    expect(screen.queryByRole('button', { name: 'Pay now' })).toBeNull();
  });

  it('pays with bKash: sheet shows the number, sends the exact body, reloads', async () => {
    mockGet.mockResolvedValue(withWallets);
    mockPost.mockResolvedValue({});
    await renderFee();
    await fireEvent.press(await screen.findByRole('button', { name: 'Pay now' }));
    expect(screen.getByText('Pay the platform fee')).toBeTruthy();
    expect(screen.getByText('Paying by card is on the web. Open the owner portal to pay by card.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'bKash' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Nagad' })).toBeTruthy();
    expect(screen.getByText('Reference: your team name')).toBeTruthy();
    expect(screen.getByDisplayValue('1200.00')).toBeTruthy();

    await fireEvent.press(screen.getByRole('radio', { name: 'Nagad' }));
    await fireEvent.changeText(screen.getByLabelText('Amount'), '500');
    await fireEvent.changeText(screen.getByLabelText('Transaction ID'), ' abc12345xy ');
    await fireEvent.changeText(screen.getByLabelText('Sent from'), '01712345678');
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Send for checking' }));
    });
    expect(mockPost).toHaveBeenCalledWith('/owners/o1/platform-payouts', {
      currency: 'BDT',
      amount: 50000,
      method: 'nagad',
      trxId: 'ABC12345XY',
      senderNumber: '01712345678',
    });
    expect(await screen.findByText("Sent. It shows as paid once the platform checks your TrxID.")).toBeTruthy();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('blocks an empty TrxID and an amount over what can be paid', async () => {
    mockGet.mockResolvedValue(withWallets);
    await renderFee();
    await fireEvent.press(await screen.findByRole('button', { name: 'Pay now' }));
    await fireEvent.changeText(screen.getByLabelText('Amount'), '5000');
    await fireEvent.changeText(screen.getByLabelText('Sent from'), '01712345678');
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Send for checking' }));
    });
    expect(screen.getByText('Enter the Transaction ID: 8 to 12 letters and numbers.')).toBeTruthy();
    expect(screen.getByText(/^You can pay at most /)).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('method_unavailable shows the error and reloads', async () => {
    mockGet.mockResolvedValue(withWallets);
    const { ApiError } = jest.requireActual('../../../src/lib/api');
    mockPost.mockRejectedValue(new ApiError(409, 'method_unavailable', 'gone'));
    await renderFee();
    await fireEvent.press(await screen.findByRole('button', { name: 'Pay now' }));
    await fireEvent.changeText(screen.getByLabelText('Transaction ID'), 'ABC12345XY');
    await fireEvent.changeText(screen.getByLabelText('Sent from'), '01712345678');
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Send for checking' }));
    });
    expect(await screen.findByText('This way to pay is not available now. Pick another one.')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('needs settings.edit', async () => {
    await renderFee(SYSTEM_ROLES.manager);
    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
