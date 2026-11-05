import { render, screen } from '@testing-library/react-native';
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

const mockGet = jest.fn();
jest.mock('../../../src/lib/api', () => {
  const actual = jest.requireActual('../../../src/lib/api');
  return { ...actual, apiGet: (...a: unknown[]) => mockGet(...a) };
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

describe('platform fee', () => {
  it('shows what is owed, the pay-on-web note and the history', async () => {
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
  });

  it('needs settings.edit', async () => {
    await renderFee(SYSTEM_ROLES.manager);
    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
