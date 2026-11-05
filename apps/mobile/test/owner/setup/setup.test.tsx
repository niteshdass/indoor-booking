import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { CouponJson } from '@booking/shared';
import type { Addon, Assignment, Closure, OwnerTurf, Permission } from '../../../src/owner/types';
import ClosuresScreen from '../../../app/owner/[ownerId]/closures';
import CouponsScreen from '../../../app/owner/[ownerId]/coupons';
import ExtrasScreen from '../../../app/owner/[ownerId]/extras';
import { couponBody, draftFromCoupon } from '../../../src/owner/setup/couponForm';
import { todayIso } from '../../../src/owner/setup/dates';
import { OwnerWrap, ownerValue } from '../ownerFixture';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
jest.mock('../../../src/lib/api', () => ({
  ...jest.requireActual('../../../src/lib/api'),
  apiGet: (...a: unknown[]) => mockGet(...a),
  apiPost: (...a: unknown[]) => mockPost(...a),
  apiPatch: (...a: unknown[]) => mockPatch(...a),
  apiPut: (...a: unknown[]) => mockPut(...a),
  apiDelete: (...a: unknown[]) => mockDelete(...a),
}));

const turf = { id: 't1', venueId: 'v1', name: 'Court A' } as OwnerTurf;
const closures: Closure[] = [
  { id: 'c1', venueId: null, turfId: null, from: '2026-12-25', to: '2026-12-26', reason: 'Holiday' },
  { id: 'c2', venueId: 'v1', turfId: 't1', from: '2026-12-01', to: '2026-12-01', reason: null },
];
const coupon: CouponJson = {
  id: 'k1',
  code: 'EID10',
  type: 'percent',
  value: 10,
  currency: 'BDT',
  venueIds: [],
  validFrom: null,
  validUntil: null,
  maxUses: 50,
  maxUsesPerCustomer: 2,
  minSubtotal: 50000,
  maxDiscount: null,
  active: true,
  uses: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const addon: Addon = { id: 'a1', name: 'Bibs', pricingType: 'per_booking', price: 10000, currency: 'BDT', maxQuantity: 1, stock: null, autoApply: null };
const assignment: Assignment = { id: 'as1', addonId: 'a1', venueId: 'v1', turfId: null, enabled: false, priceOverride: null, stock: 5 };

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation(async (path: string) => {
    if (path === '/owners/o1/venues/v1/turfs') return { turfs: [turf] };
    if (path === '/owners/o1/closures') return { closures };
    if (path === '/owners/o1/coupons') return { coupons: [coupon] };
    if (path === '/owners/o1/addons') return { addons: [addon] };
    if (path === '/owners/o1/venues/v1/addons') return { assignments: [assignment] };
    throw new Error(`unexpected ${path}`);
  });
});

const show = async (el: React.ReactElement, over: Parameters<typeof ownerValue>[0] = {}) => {
  await render(<OwnerWrap value={ownerValue(over)}>{el}</OwnerWrap>);
  await act(async () => {});
};

describe('closures', () => {
  it('lists closures with their scope', async () => {
    await show(<ClosuresScreen />);
    expect(screen.getByText('Whole business')).toBeTruthy();
    expect(screen.getByText('Arena One · Court A')).toBeTruthy();
  });

  it('adds a one-court closure with the web body', async () => {
    mockPost.mockResolvedValue({ closure: {} });
    await show(<ClosuresScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Add closure' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'One court' }));
    await fireEvent.changeText(screen.getByLabelText('Reason (optional)'), ' Repairs ');
    await fireEvent.press(screen.getByRole('button', { name: 'Save closure' }));
    await act(async () => {});
    const day = todayIso();
    expect(mockPost).toHaveBeenCalledWith('/owners/o1/closures', { venueId: 'v1', turfId: 't1', from: day, to: day, reason: 'Repairs' });
  });

  it('deletes after confirming', async () => {
    mockDelete.mockResolvedValue(undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
      void (args[2] as { onPress?: () => unknown }[])[1]!.onPress!();
    });
    await show(<ClosuresScreen />);
    await fireEvent.press(screen.getAllByRole('button', { name: /Delete closure/ })[0]!);
    await act(async () => {});
    expect(mockDelete).toHaveBeenCalledWith('/owners/o1/closures/c1');
    alert.mockRestore();
  });

  it('hides add and delete without slot.override or settings.edit', async () => {
    await show(<ClosuresScreen />, { perms: ['booking.view'] as Permission[] });
    expect(screen.queryByRole('button', { name: 'Add closure' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete closure/ })).toBeNull();
  });
});

describe('coupons', () => {
  it('shows code, discount and usage, and switches a code off', async () => {
    mockPatch.mockResolvedValue({ coupon: { ...coupon, active: false } });
    await show(<CouponsScreen />);
    expect(screen.getByText('EID10')).toBeTruthy();
    expect(screen.getByText(/10% off · 3 of 50 used/)).toBeTruthy();
    await fireEvent(screen.getByLabelText('EID10 on'), 'valueChange', false);
    await act(async () => {});
    expect(mockPatch).toHaveBeenCalledWith('/owners/o1/coupons/k1', { active: false });
  });

  it('creates a coupon with the full body', async () => {
    mockPost.mockResolvedValue({ coupon });
    await show(<CouponsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'New coupon' }));
    await fireEvent.changeText(screen.getByLabelText('Code'), 'new5');
    await fireEvent.changeText(screen.getByLabelText('Percent off (%)'), '5');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await act(async () => {});
    expect(mockPost).toHaveBeenCalledWith('/owners/o1/coupons', {
      code: 'NEW5',
      type: 'percent',
      value: 5,
      maxDiscount: null,
      minSubtotal: 0,
      validFrom: null,
      validUntil: null,
      maxUses: null,
      maxUsesPerCustomer: null,
      venueIds: [],
      active: true,
    });
  });

  it('patches only what changed, keeping web-only fields', () => {
    const res = couponBody({ ...draftFromCoupon(coupon), maxUses: '100' }, coupon, 'BDT');
    expect(res).toEqual({ ok: true, body: { maxUses: 100 } });
  });

  it('is read-only for venue-scoped members', async () => {
    const base = ownerValue();
    await show(<CouponsScreen />, { membership: { ...base.membership, venueIds: ['v1'] } });
    expect(screen.getByText('Only members with access to every venue can change coupons.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New coupon' })).toBeNull();
    expect(screen.queryByLabelText('EID10 on')).toBeNull();
  });
});

describe('extras', () => {
  it('offers an extra at the venue, keeping its stock', async () => {
    mockPut.mockResolvedValue({ assignment: { ...assignment, enabled: true } });
    await show(<ExtrasScreen />);
    expect(screen.getByText('Bibs')).toBeTruthy();
    await fireEvent(screen.getByLabelText('Offer Bibs'), 'valueChange', true);
    await act(async () => {});
    expect(mockPut).toHaveBeenCalledWith('/owners/o1/venues/v1/addons/a1', { enabled: true, priceOverride: null, stock: 5 });
  });

  it('sets a venue price from the sheet', async () => {
    mockPut.mockResolvedValue({ assignment });
    await show(<ExtrasScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /^Bibs/ }));
    await fireEvent.changeText(screen.getByLabelText('Price here (BDT)'), '150');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await act(async () => {});
    expect(mockPut).toHaveBeenCalledWith('/owners/o1/venues/v1/addons/a1', { enabled: false, priceOverride: 15000, stock: 5 });
  });
});
