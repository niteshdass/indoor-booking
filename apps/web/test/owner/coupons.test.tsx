import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { CouponJson } from '@booking/shared';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { couponBody, EMPTY_COUPON_DRAFT, type CouponDraft } from '../../src/owner/coupons/couponForm';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, ownerRoutes, staffUser } from './fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const C = en.owner.coupons;
const PERMS = ['booking.view', 'coupon.manage'] as const;
const URL = `/owner/${OWNER_ID}/coupons`;

const coupon = (over: Partial<CouponJson> = {}): CouponJson => ({
  id: 'c1',
  code: 'EID10',
  type: 'percent',
  value: 10,
  currency: 'BDT',
  venueIds: [],
  validFrom: null,
  validUntil: null,
  maxUses: 50,
  maxUsesPerCustomer: null,
  minSubtotal: 0,
  maxDiscount: 50000,
  active: true,
  uses: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});
const draft = (over: Partial<CouponDraft> = {}): CouponDraft => ({ ...EMPTY_COUPON_DRAFT, code: 'EID10', value: '10', ...over });

describe('couponBody', () => {
  it('builds the POST body in minor units with blanks as null', () => {
    expect(couponBody(draft({ code: ' eid10 ', maxDiscount: '500', minSubtotal: '1000' }), null, 'BDT')).toEqual({
      ok: true,
      body: {
        code: 'EID10',
        type: 'percent',
        value: 10,
        maxDiscount: 50000,
        minSubtotal: 100000,
        validFrom: null,
        validUntil: null,
        maxUses: null,
        maxUsesPerCustomer: null,
        venueIds: [],
        active: true,
      },
    });
    expect(couponBody(draft({ type: 'fixed', value: '300', maxDiscount: '500' }), null, 'BDT')).toMatchObject({
      ok: true,
      body: { type: 'fixed', value: 30000, maxDiscount: null },
    });
  });

  it('refuses a bad code, percent, limits and an empty venue choice', () => {
    const res = couponBody(draft({ code: 'X', value: '120', maxUses: '0', allVenues: false, venueIds: [] }), null, 'BDT');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors).toEqual({
        code: 'owner.coupons.err.code',
        value: 'owner.coupons.err.percent',
        maxUses: 'owner.coupons.err.maxUses',
        venues: 'owner.coupons.err.venues',
      });
    }
  });

  it('on edit sends only the changed keys', () => {
    const orig = coupon();
    expect(couponBody(draft({ maxDiscount: '500.00', maxUses: '50' }), orig, 'BDT')).toEqual({ ok: true, body: {} });
    expect(couponBody(draft({ maxDiscount: '500.00', maxUses: '', active: false }), orig, 'BDT')).toEqual({
      ok: true,
      body: { maxUses: null, active: false },
    });
  });
});

describe('coupons page', () => {
  it('lists codes with discount, uses and status', async () => {
    mockApi([
      {
        path: '/owners/o1/coupons',
        body: { coupons: [coupon(), coupon({ id: 'c2', code: 'FLAT300', type: 'fixed', value: 30000, maxDiscount: null, maxUses: null, active: false, uses: 0 })] },
      },
      ...ownerRoutes({ permissions: [...PERMS] }),
    ]);
    renderApp(URL, { user: staffUser });
    const row = (await screen.findByText('EID10')).closest('tr')!;
    expect(within(row).getByText('3 / 50')).toBeTruthy();
    expect(within(row).getByText(C.state.active)).toBeTruthy();
    expect(within(row).getByText(C.allVenues)).toBeTruthy();
    const flat = screen.getByText('FLAT300').closest('tr')!;
    expect(within(flat).getByText(/300\.00 off/)).toBeTruthy();
    expect(within(flat).getByText(C.state.off)).toBeTruthy();
    expect(within(flat).getByRole('button', { name: 'Turn on FLAT300' })).toBeTruthy();
  });

  it('shows the empty state', async () => {
    mockApi([{ path: '/owners/o1/coupons', body: { coupons: [] } }, ...ownerRoutes({ permissions: [...PERMS] })]);
    renderApp(URL, { user: staffUser });
    expect(await screen.findByText(C.empty)).toBeTruthy();
  });

  it('creates a coupon', async () => {
    const { calls } = mockApi([
      { method: 'POST', path: '/owners/o1/coupons', status: 201, body: { coupon: coupon() } },
      { path: '/owners/o1/coupons', body: { coupons: [] } },
      ...ownerRoutes({ permissions: [...PERMS] }),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: C.add }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(C.field.code), 'eid10');
    await user.type(within(dialog).getByLabelText(C.field.percent), '10');
    await user.type(within(dialog).getByLabelText('Max discount (BDT)'), '500');
    await user.type(within(dialog).getByLabelText(C.field.maxUses), '50');
    await user.click(within(dialog).getByRole('button', { name: C.save }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      code: 'EID10',
      type: 'percent',
      value: 10,
      maxDiscount: 50000,
      minSubtotal: 0,
      validFrom: null,
      validUntil: null,
      maxUses: 50,
      maxUsesPerCustomer: null,
      venueIds: [],
      active: true,
    });
  });

  it('turns a coupon off', async () => {
    const { calls } = mockApi([
      { method: 'PATCH', path: '/owners/o1/coupons/c1', body: { coupon: coupon({ active: false }) } },
      { path: '/owners/o1/coupons', body: { coupons: [coupon()] } },
      ...ownerRoutes({ permissions: [...PERMS] }),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: 'Turn off EID10' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ active: false }));
  });

  it('hides writes for venue-scoped members', async () => {
    mockApi([{ path: '/owners/o1/coupons', body: { coupons: [coupon()] } }, ...ownerRoutes({ permissions: [...PERMS], venueIds: ['v1'] })]);
    renderApp(URL, { user: staffUser });
    expect(await screen.findByText('EID10')).toBeTruthy();
    expect(screen.getByText(C.ownerWideOnly)).toBeTruthy();
    expect(screen.queryByRole('button', { name: C.add })).toBeNull();
  });
});
