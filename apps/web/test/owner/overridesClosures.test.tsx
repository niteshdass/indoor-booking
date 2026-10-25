import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { overrideBody, type OverrideDraft } from '../../src/owner/schedule/overrideBody';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, ownerRoutes, slotDay, staffUser, turf, venue } from './fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const O = en.owner.override;
const C = en.owner.closures;
const TURF = '/owners/o1/venues/v1/turfs/t1';
const OVERRIDES = `${TURF}/overrides`;
const OVERRIDES_URL = `/owner/${OWNER_ID}/venues/v1/turfs/t1?tab=overrides&month=2026-10`;
const CLOSURES_URL = `/owner/${OWNER_ID}/closures`;

const draft = (over: Partial<OverrideDraft> = {}): OverrideDraft => ({
  type: 'block',
  when: 'date',
  date: '2026-10-26',
  weekdays: [],
  from: '',
  until: '',
  start: '10:00',
  end: '12:00',
  slotStart: '',
  price: '',
  reason: '',
  ...over,
});

describe('overrideBody', () => {
  it('overrideBody builds each type with date or recurrence and omits empty reason', () => {
    expect(overrideBody(draft(), 'BDT')).toEqual({ ok: true, body: { type: 'block', date: '2026-10-26', start: '10:00', end: '12:00' } });
    expect(overrideBody(draft({ type: 'modify', slotStart: '10:00', start: '10:30', end: '11:30', price: '12.50', reason: ' Cup ' }), 'USD')).toEqual({
      ok: true,
      body: { type: 'modify', date: '2026-10-26', slotStart: '10:00', start: '10:30', end: '11:30', price: 1250, reason: 'Cup' },
    });
    expect(overrideBody(draft({ type: 'add', start: '22:00', end: '01:00' }), 'BDT')).toEqual({
      ok: true,
      body: { type: 'add', date: '2026-10-26', start: '22:00', end: '01:00' },
    });
    expect(overrideBody(draft({ type: 'close', start: '', end: '', reason: '   ' }), 'BDT')).toEqual({
      ok: true,
      body: { type: 'close', date: '2026-10-26' },
    });
    expect(
      overrideBody(draft({ type: 'close', when: 'recurring', date: '', weekdays: ['sat', 'mon'], from: '2026-11-01', until: '2026-12-31' }), 'BDT'),
    ).toEqual({
      ok: true,
      body: { type: 'close', recurrence: { weekdays: ['mon', 'sat'], from: '2026-11-01', until: '2026-12-31' } },
    });
    const open = overrideBody(draft({ when: 'recurring', date: '', weekdays: ['mon'], from: '2026-11-01' }), 'BDT');
    expect(open).toEqual({
      ok: true,
      body: { type: 'block', start: '10:00', end: '12:00', recurrence: { weekdays: ['mon'], from: '2026-11-01' } },
    });
  });

  it('overrideBody requires a weekday for recurring overrides', () => {
    const res = overrideBody(draft({ when: 'recurring', date: '', weekdays: [], from: '2026-11-01' }), 'BDT');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.weekdays).toBe('owner.override.err.weekdays');
    const bad = overrideBody(draft({ when: 'recurring', date: '', weekdays: ['mon'], from: '2026-11-05', until: '2026-11-01' }), 'BDT');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.until).toBe('owner.override.err.until');
  });
});

describe('overrides tab', () => {
  it('override_overlap from the API is shown translated', async () => {
    const { calls } = mockApi([
      { method: 'POST', path: OVERRIDES, status: 409, body: { error: { code: 'override_overlap', message: 'x' } } },
      { path: OVERRIDES, body: { overrides: [] } },
      { path: TURF, body: { turf: turf() } },
      ...ownerRoutes({ permissions: ['booking.view', 'slot.override'] }),
    ]);
    const { user } = renderApp(OVERRIDES_URL, { user: staffUser });
    expect(await screen.findByText(O.empty)).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: O.add }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(O.existingBookings)).toBeTruthy();
    await user.type(within(dialog).getByLabelText(O.date), '2026-10-26');
    await user.type(within(dialog).getByLabelText(O.start), '10:00');
    await user.type(within(dialog).getByLabelText(O.end), '12:00');
    await user.click(within(dialog).getByRole('button', { name: O.save }));
    expect(await within(dialog).findByText(en.errors.override_overlap)).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ type: 'block', date: '2026-10-26', start: '10:00', end: '12:00' });
    const get = calls.find((c) => c.method === 'GET' && c.path === OVERRIDES)!;
    expect(get.query.get('from')).toBe('2026-10-01');
    expect(get.query.get('to')).toBe('2026-10-31');
  });

  it('modify offers the generated slot starts for the date', async () => {
    const day = slotDay({
      slots: [
        { ...slotDay().slots[0]!, localStart: '10:00', localEnd: '11:00' },
        { ...slotDay().slots[0]!, localStart: '11:00', localEnd: '12:00' },
      ],
    });
    mockApi([
      { path: `${TURF}/slots`, body: { day } },
      { path: OVERRIDES, body: { overrides: [] } },
      { path: TURF, body: { turf: turf() } },
      ...ownerRoutes({ permissions: ['booking.view', 'slot.override'] }),
    ]);
    const { user } = renderApp(OVERRIDES_URL, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: O.add }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(O.typeLabel), 'modify');
    await user.type(within(dialog).getByLabelText(O.date), '2026-10-26');
    const select = (await within(dialog).findByLabelText(O.slotStart)) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(select.options).map((o) => o.value)).toEqual(['', '10:00', '11:00']));
  });

  it('is read-only without slot.override and lists rows with delete', async () => {
    mockApi([
      {
        path: OVERRIDES,
        body: {
          overrides: [
            { id: 'ov1', venueId: 'v1', turfId: 't1', type: 'close', date: '2026-10-28', reason: 'Holiday' },
          ],
        },
      },
      { path: TURF, body: { turf: turf() } },
      ...ownerRoutes({ permissions: ['booking.view'] }),
    ]);
    renderApp(OVERRIDES_URL, { user: staffUser });
    expect(await screen.findByText('Holiday')).toBeTruthy();
    expect(screen.queryByRole('button', { name: O.add })).toBeNull();
    expect(screen.queryByRole('button', { name: O.delete })).toBeNull();
  });
});

const closure = (over = {}) => ({ id: 'c1', venueId: null, turfId: null, from: '2026-12-24', to: '2026-12-26', reason: 'Holiday', ...over });

describe('closures page', () => {
  it('closure scope owner-wide hidden for scoped members', async () => {
    mockApi([
      { path: '/owners/o1/closures', body: { closures: [] } },
      { path: '/owners/o1/venues/v1/turfs', body: { turfs: [turf()] } },
      ...ownerRoutes({ permissions: ['slot.override', 'settings.edit'], venueIds: ['v1'] }),
    ]);
    const first = renderApp(CLOSURES_URL, { user: staffUser });
    await first.user.click(await screen.findByRole('button', { name: C.add }));
    let scope = within(screen.getByRole('dialog')).getByLabelText(C.scopeLabel) as HTMLSelectElement;
    expect(Array.from(scope.options).map((o) => o.value)).toEqual(['venue', 'turf']);
    first.unmount();

    mockApi([
      { path: '/owners/o1/closures', body: { closures: [] } },
      { path: '/owners/o1/venues/v1/turfs', body: { turfs: [turf()] } },
      ...ownerRoutes({ permissions: ['slot.override', 'settings.edit'] }),
    ]);
    const second = renderApp(CLOSURES_URL, { user: staffUser });
    await second.user.click(await screen.findByRole('button', { name: C.add }));
    scope = within(screen.getByRole('dialog')).getByLabelText(C.scopeLabel) as HTMLSelectElement;
    expect(Array.from(scope.options).map((o) => o.value)).toEqual(['owner', 'venue', 'turf']);
  });

  it('closure range over 366 days is rejected before posting', async () => {
    const { calls } = mockApi([
      { method: 'POST', path: '/owners/o1/closures', status: 201, body: { closure: closure() } },
      { path: '/owners/o1/closures', body: { closures: [] } },
      { path: '/owners/o1/venues/v1/turfs', body: { turfs: [turf()] } },
      ...ownerRoutes({ permissions: ['slot.override'], venues: [venue()] }),
    ]);
    const { user } = renderApp(CLOSURES_URL, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: C.add }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(C.from), '2026-01-01');
    await user.type(within(dialog).getByLabelText(C.to), '2027-01-02');
    await user.click(within(dialog).getByRole('button', { name: C.save }));
    expect(await within(dialog).findByText(C.err.long)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    const to = within(dialog).getByLabelText(C.to);
    await user.clear(to);
    await user.type(to, '2027-01-01');
    await user.click(within(dialog).getByRole('button', { name: C.save }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeTruthy());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ venueId: 'v1', from: '2026-01-01', to: '2027-01-01' });
  });

  it('deleting a closure removes the row', async () => {
    let deleted = false;
    const { calls } = mockApi([
      {
        method: 'DELETE',
        path: '/owners/o1/closures/c1',
        status: 204,
        body: () => {
          deleted = true;
          return undefined;
        },
      },
      {
        path: '/owners/o1/closures',
        body: () => ({
          closures: [...(deleted ? [] : [closure()]), closure({ id: 'c2', venueId: 'v1', turfId: 't1', reason: 'Resurfacing' })],
        }),
      },
      { path: '/owners/o1/venues/v1/turfs', body: { turfs: [turf()] } },
      ...ownerRoutes({ permissions: ['slot.override', 'settings.edit'] }),
    ]);
    const { user } = renderApp(CLOSURES_URL, { user: staffUser });
    expect(await screen.findByText('Holiday')).toBeTruthy();
    expect(await screen.findByText('Arena One · Pitch A')).toBeTruthy();
    expect(screen.getByText(C.scopeOwner)).toBeTruthy();
    const row = screen.getByText('Holiday').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: C.delete }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: C.deleteConfirm }));
    await waitFor(() => expect(screen.queryByText('Holiday')).toBeNull());
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/owners/o1/closures/c1')).toBe(true);
    expect(screen.getByText('Resurfacing')).toBeTruthy();
  });
});
