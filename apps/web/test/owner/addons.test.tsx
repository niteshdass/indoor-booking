import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { addonBody, type AddonDraft } from '../../src/owner/addons/addonForm';
import type { Addon, Assignment } from '../../src/owner/types';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, membership, ownerInfo, ownerRoutes, staffUser, turf } from './fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const A = en.owner.addons;
const PERMS = ['booking.view', 'addon.manage'] as const;

const addon = (over: Partial<Addon> = {}): Addon => ({
  id: 'a1',
  name: 'Bibs',
  pricingType: 'per_booking',
  price: 500,
  currency: 'BDT',
  maxQuantity: 1,
  stock: null,
  autoApply: null,
  ...over,
});
const assignment = (over: Partial<Assignment> = {}): Assignment => ({
  id: 's1',
  addonId: 'a1',
  venueId: 'v1',
  turfId: null,
  enabled: true,
  priceOverride: null,
  stock: null,
  ...over,
});
const draft = (over: Partial<AddonDraft> = {}): AddonDraft => ({
  name: 'Bibs',
  pricingType: 'per_booking',
  price: '5.00',
  maxQuantity: '1',
  stock: '',
  autoApply: false,
  autoAllDay: true,
  autoStart: '',
  autoEnd: '',
  outdoorOnly: false,
  ...over,
});

describe('addonBody', () => {
  it('addonBody rejects auto-apply with per_unit or stock', () => {
    const unit = addonBody(draft({ pricingType: 'per_unit', autoApply: true }), null, 'BDT');
    expect(unit.ok).toBe(false);
    if (!unit.ok) expect(unit.errors.autoApply).toBe('owner.addons.autoConflict');
    const stocked = addonBody(draft({ stock: '5', autoApply: true }), null, 'BDT');
    expect(stocked.ok).toBe(false);
    if (!stocked.ok) expect(stocked.errors.autoApply).toBe('owner.addons.autoConflict');
    expect(addonBody(draft({ autoApply: true, outdoorOnly: true }), null, 'BDT')).toEqual({
      ok: true,
      body: { name: 'Bibs', pricingType: 'per_booking', price: 500, maxQuantity: 1, stock: null, autoApply: { outdoorOnly: true } },
    });
  });

  it('addonBody on edit sends only changed keys', () => {
    const orig = addon({ stock: 4, autoApply: { range: { start: '18:00', end: '22:00' }, outdoorOnly: false } });
    const same = draft({ stock: '4', autoApply: false });
    // The stored add-on has auto-apply, so a draft without it changes autoApply only (stock stays).
    expect(addonBody(same, orig, 'BDT')).toEqual({ ok: true, body: { autoApply: null } });
    expect(addonBody(draft({ price: '6.50', stock: '', autoApply: true, autoAllDay: false, autoStart: '18:00', autoEnd: '22:00' }), orig, 'BDT')).toEqual({
      ok: true,
      body: { price: 650, stock: null },
    });
    expect(addonBody(draft({ name: ' Bibs ' }), addon(), 'BDT')).toEqual({ ok: true, body: {} });
  });

  it('addonBody converts the price with the currency exponent', () => {
    const res = addonBody(draft({ price: '1200' }), null, 'JPY');
    expect(res).toMatchObject({ ok: true, body: { price: 1200 } });
    const bad = addonBody(draft({ price: '12.5' }), null, 'JPY');
    expect(bad.ok).toBe(false);
  });
});

const ADDONS_URL = `/owner/${OWNER_ID}/addons`;
const VENUE_ADDONS_URL = `/owner/${OWNER_ID}/venues/v1?tab=addons`;
const TURF_ADDONS_URL = `/owner/${OWNER_ID}/venues/v1/turfs/t1?tab=addons`;

describe('catalogue page', () => {
  it('create add-on posts minor-unit price', async () => {
    const { calls } = mockApi([
      { method: 'POST', path: '/owners/o1/addons', status: 201, body: { addon: addon() } },
      { path: '/owners/o1/addons', body: { addons: [] } },
      ...ownerRoutes({ permissions: [...PERMS] }),
    ]);
    const { user } = renderApp(ADDONS_URL, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: A.add }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Bibs');
    await user.type(within(dialog).getByLabelText('Price (BDT)'), '12.50');
    await user.click(within(dialog).getByRole('button', { name: A.save }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Bibs',
      pricingType: 'per_booking',
      price: 1250,
      maxQuantity: 1,
      stock: null,
    });
  });

  it('create add-on in a 0-decimal currency posts the whole amount', async () => {
    const { calls } = mockApi([
      { method: 'POST', path: '/owners/o1/addons', status: 201, body: { addon: addon() } },
      { path: '/owners/o1/addons', body: { addons: [] } },
      { path: '/owners/o1', body: { owner: ownerInfo({ defaultCurrency: 'JPY' }), membership: membership({ permissions: [...PERMS] }) } },
      ...ownerRoutes({ permissions: [...PERMS] }),
    ]);
    const { user } = renderApp(ADDONS_URL, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: A.add }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Bibs');
    await user.type(within(dialog).getByLabelText('Price (JPY)'), '1200');
    await user.click(within(dialog).getByRole('button', { name: A.save }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ price: 1200 });
  });

  it('lists the catalogue with type, price and auto badge', async () => {
    mockApi([
      { path: '/owners/o1/addons', body: { addons: [addon({ stock: 3 }), addon({ id: 'a2', name: 'Lights', pricingType: 'per_hour', autoApply: { outdoorOnly: true } })] } },
      ...ownerRoutes({ permissions: [...PERMS] }),
    ]);
    renderApp(ADDONS_URL, { user: staffUser });
    const row = (await screen.findByText('Lights')).closest('tr')!;
    expect(within(row).getByText(A.type.per_hour)).toBeTruthy();
    expect(within(row).getByText(A.autoBadge)).toBeTruthy();
    expect(within(row).getByText(A.unlimited)).toBeTruthy();
  });

  it('catalogue writes hidden for venue-scoped members', async () => {
    mockApi([
      { path: '/owners/o1/addons', body: { addons: [addon()] } },
      ...ownerRoutes({ permissions: [...PERMS], venueIds: ['v1'] }),
    ]);
    renderApp(ADDONS_URL, { user: staffUser });
    expect(await screen.findByText('Bibs')).toBeTruthy();
    expect(screen.getByText(A.ownerWideOnly)).toBeTruthy();
    expect(screen.queryByRole('button', { name: A.add })).toBeNull();
    expect(screen.queryByRole('button', { name: A.edit })).toBeNull();
    expect(screen.queryByRole('button', { name: A.delete })).toBeNull();
  });

  it('delete asks for confirmation then deletes', async () => {
    const { calls } = mockApi([
      { method: 'DELETE', path: '/owners/o1/addons/a1', status: 204, body: undefined },
      { path: '/owners/o1/addons', body: { addons: [addon()] } },
      ...ownerRoutes({ permissions: [...PERMS] }),
    ]);
    const { user } = renderApp(ADDONS_URL, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: A.delete }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(await screen.findByRole('button', { name: A.deleteConfirm }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});

describe('assignments', () => {
  it('assignment save puts enabled and price override; turf rows omit stock', async () => {
    const { calls } = mockApi([
      { method: 'PUT', path: '/owners/o1/venues/v1/addons/a1', body: { assignment: assignment({ priceOverride: 700, stock: 5 }) } },
      { method: 'PUT', path: '/owners/o1/venues/v1/turfs/t1/addons/a1', body: { assignment: assignment({ turfId: 't1' }) } },
      { path: '/owners/o1/addons', body: { addons: [addon()] } },
      { path: '/owners/o1/venues/v1/addons', body: { assignments: [] } },
      { path: '/owners/o1/venues/v1/turfs/t1', body: { turf: turf() } },
      ...ownerRoutes({ permissions: [...PERMS] }),
    ]);
    const first = renderApp(VENUE_ADDONS_URL, { user: staffUser });
    expect(await screen.findByText(A.offeredHint)).toBeTruthy();
    await first.user.click(screen.getByLabelText(A.assign.enabledLabel));
    await first.user.type(screen.getByLabelText(/Bibs price override/), '7');
    await first.user.type(screen.getByLabelText(/Bibs stock/), '5');
    await first.user.click(screen.getByRole('button', { name: 'Save Bibs' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ enabled: true, priceOverride: 700, stock: 5 });
    first.unmount();

    const second = renderApp(TURF_ADDONS_URL, { user: staffUser });
    expect(await screen.findByText(A.offeredHint)).toBeTruthy();
    expect(screen.queryByLabelText(/Bibs stock/)).toBeNull();
    await second.user.click(screen.getByLabelText(A.assign.enabledLabel));
    await second.user.click(screen.getByRole('button', { name: 'Save Bibs' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'PUT')[1]?.body).toEqual({ enabled: true, priceOverride: null });
  });

  it('turf tab shows only its own assignments and Remove deletes', async () => {
    const { calls } = mockApi([
      { method: 'DELETE', path: '/owners/o1/venues/v1/turfs/t1/addons/a1', status: 204, body: undefined },
      { path: '/owners/o1/addons', body: { addons: [addon()] } },
      { path: '/owners/o1/venues/v1/addons', body: { assignments: [assignment(), assignment({ id: 's2', turfId: 't2', priceOverride: 900 })] } },
      { path: '/owners/o1/venues/v1/turfs/t1', body: { turf: turf() } },
      ...ownerRoutes({ permissions: [...PERMS] }),
    ]);
    renderApp(TURF_ADDONS_URL, { user: staffUser });
    expect(await screen.findByText(A.offeredHint)).toBeTruthy();
    // The venue-level and t2 rows are not this turf's: it has no assignment yet, so no Remove.
    expect(screen.queryByRole('button', { name: 'Remove Bibs' })).toBeNull();
    expect((screen.getByLabelText(A.assign.enabledLabel) as HTMLInputElement).checked).toBe(false);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('Remove deletes the venue-level assignment', async () => {
    const { calls } = mockApi([
      { method: 'DELETE', path: '/owners/o1/venues/v1/addons/a1', status: 204, body: undefined },
      { path: '/owners/o1/addons', body: { addons: [addon()] } },
      { path: '/owners/o1/venues/v1/addons', body: { assignments: [assignment({ priceOverride: 700 })] } },
      ...ownerRoutes({ permissions: [...PERMS] }),
    ]);
    const { user } = renderApp(VENUE_ADDONS_URL, { user: staffUser });
    expect(((await screen.findByLabelText(/Bibs price override/)) as HTMLInputElement).value).toBe('7.00');
    await user.click(screen.getByRole('button', { name: 'Remove Bibs' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('price_override_required is shown translated', async () => {
    mockApi([
      { path: '/owners/o1/addons', body: { addons: [addon({ currency: 'USD' })] } },
      { path: '/owners/o1/venues/v1/addons', body: { assignments: [] } },
      ...ownerRoutes({ permissions: [...PERMS] }),
    ]);
    const { user } = renderApp(VENUE_ADDONS_URL, { user: staffUser });
    await user.click(await screen.findByLabelText(A.assign.enabledLabel));
    await user.click(screen.getByRole('button', { name: 'Save Bibs' }));
    expect(await screen.findByText(en.errors.price_override_required)).toBeTruthy();
  });

  it('the API price_override_required error is translated', async () => {
    mockApi([
      { method: 'PUT', path: '/owners/o1/venues/v1/turfs/t1/addons/a1', status: 400, body: { error: { code: 'price_override_required', message: 'x' } } },
      { path: '/owners/o1/addons', body: { addons: [addon({ currency: 'USD' })] } },
      { path: '/owners/o1/venues/v1/addons', body: { assignments: [] } },
      { path: '/owners/o1/venues/v1/turfs/t1', body: { turf: turf() } },
      ...ownerRoutes({ permissions: [...PERMS] }),
    ]);
    const { user } = renderApp(TURF_ADDONS_URL, { user: staffUser });
    await user.click(await screen.findByLabelText(A.assign.enabledLabel));
    await user.click(screen.getByRole('button', { name: 'Save Bibs' }));
    expect(await screen.findByText(en.errors.price_override_required)).toBeTruthy();
  });
});
