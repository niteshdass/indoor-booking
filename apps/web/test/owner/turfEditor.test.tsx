import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { draftFromPricing, pricingFromDraft, type PricingDraft } from '../../src/owner/turfs/pricingForm';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, ownerRoutes, staffUser, turf } from './fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const T = en.owner.turf;
const P = en.owner.pricing;
const TURF = '/owners/o1/venues/v1/turfs/t1';
const URL = `/owner/${OWNER_ID}/venues/v1/turfs/t1`;
const MANAGE = ['booking.view', 'turf.manage', 'pricing.edit'] as const;

const rule = (over: Partial<PricingDraft['rules'][number]> = {}): PricingDraft['rules'][number] => ({
  kind: 'weekday',
  date: '',
  allDay: true,
  start: '',
  end: '',
  price: '10',
  ...over,
});

describe('pricingFromDraft', () => {
  it('pricingFromDraft parses minor units and omits range for all-day rules', () => {
    const res = pricingFromDraft(
      {
        base: '10.50',
        rules: [
          rule({ kind: 'weekend', price: '12' }),
          rule({ kind: 'date', date: '2026-12-25', allDay: false, start: '18:00', end: '22:00', price: '20.25' }),
          rule({ kind: 'weekday', allDay: true, date: '2026-01-01', start: '09:00', price: '5' }),
        ],
      },
      'BDT',
    );
    expect(res).toEqual({
      ok: true,
      pricing: {
        base: 1050,
        rules: [
          { kind: 'weekend', price: 1200 },
          { kind: 'date', date: '2026-12-25', range: { start: '18:00', end: '22:00' }, price: 2025 },
          { kind: 'weekday', price: 500 },
        ],
      },
    });
    expect(draftFromPricing({ base: 1050, rules: [{ kind: 'weekend', price: 1200 }] }, 'BDT', 'en')).toMatchObject({
      base: '10.5',
      rules: [{ kind: 'weekend', allDay: true, price: '12' }],
    });
    expect(draftFromPricing(null, 'BDT', 'en')).toEqual({ base: '', rules: [] });
  });

  it('pricingFromDraft flags overlapping weekday ranges including across midnight', () => {
    const night = rule({ allDay: false, start: '22:00', end: '02:00' });
    const early = rule({ allDay: false, start: '01:00', end: '03:00' });
    const res = pricingFromDraft({ base: '1', rules: [night, early] }, 'BDT');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(Object.values(res.errors)).toContain('owner.pricing.overlap');

    // Touching ranges, other tiers and other dates do not clash; all-day clashes with any rule of its tier.
    const day = rule({ allDay: false, start: '02:00', end: '22:00' });
    expect(pricingFromDraft({ base: '1', rules: [night, day, rule({ kind: 'weekend', allDay: true })] }, 'BDT').ok).toBe(true);
    const d1 = rule({ kind: 'date', date: '2026-12-25' });
    const d2 = rule({ kind: 'date', date: '2026-12-26' });
    expect(pricingFromDraft({ base: '1', rules: [d1, d2] }, 'BDT').ok).toBe(true);
    expect(pricingFromDraft({ base: '1', rules: [d1, { ...d1, allDay: false, start: '10:00', end: '11:00' }] }, 'BDT').ok).toBe(false);
  });

  it('round-trips through the draft for 0, 2 and 3 decimal currencies', () => {
    for (const [currency, base, price] of [['JPY', 1500, 800], ['BDT', 1050, 5], ['KWD', 1234, 1000]] as const) {
      const p = { base, rules: [{ kind: 'weekend' as const, price }, { kind: 'date' as const, date: '2026-12-25', range: { start: '18:00', end: '22:00' }, price: base }] };
      expect(pricingFromDraft(draftFromPricing(p, currency, 'en'), currency)).toEqual({ ok: true, pricing: p });
    }
  });

  it('rejects an empty base, bad prices, dates and times', () => {
    const res = pricingFromDraft(
      { base: '', rules: [rule({ price: 'abc' }), rule({ kind: 'date', date: '2026-02-30', allDay: false, start: '', end: '10:00' })] },
      'BDT',
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(Object.keys(res.errors).sort()).toEqual(['base', 'rule.0.price', 'rule.1.date', 'rule.1.time']);
  });
});

describe('turf editor', () => {
  it('pricing editor saves the whole pricing object with PUT', async () => {
    const { calls } = mockApi([
      { method: 'PUT', path: `${TURF}/pricing`, body: { pricing: { base: 50000, rules: [{ kind: 'weekend', price: 80000 }] } } },
      { path: TURF, body: { turf: turf() } },
      ...ownerRoutes({ permissions: [...MANAGE] }),
    ]);
    const { user } = renderApp(`${URL}?tab=pricing`, { user: staffUser });
    expect(await screen.findByText(P.unpriced)).toBeTruthy();
    expect(screen.getByText(P.priority)).toBeTruthy();
    await user.type(screen.getByLabelText(P.base), '500');
    await user.click(screen.getByRole('button', { name: P.addRule }));
    await user.selectOptions(screen.getByLabelText(P.kind), 'weekend');
    await user.type(screen.getByLabelText(P.price), '800');
    await user.click(screen.getByRole('button', { name: P.save }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toBeTruthy());
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ base: 50000, rules: [{ kind: 'weekend', price: 80000 }] });
    expect(await screen.findByText(P.saved)).toBeTruthy();
  });

  it('pricing editor shows the server overlap error and is disabled without pricing.edit', async () => {
    mockApi([
      {
        method: 'PUT',
        path: `${TURF}/pricing`,
        status: 400,
        body: { error: { code: 'validation_error', message: 'Rules 0 and 1 overlap' } },
      },
      { path: TURF, body: { turf: turf({ pricing: { base: 1000, rules: [] } }) } },
      ...ownerRoutes({ permissions: [...MANAGE] }),
    ]);
    const first = renderApp(`${URL}?tab=pricing`, { user: staffUser });
    await first.user.click(await screen.findByRole('button', { name: P.save }));
    expect(await screen.findByText(P.overlap)).toBeTruthy();
    first.unmount();

    mockApi([{ path: TURF, body: { turf: turf() } }, ...ownerRoutes({ permissions: ['booking.view', 'turf.manage'] })]);
    renderApp(`${URL}?tab=pricing`, { user: staffUser });
    const base = (await screen.findByLabelText(P.base)) as HTMLInputElement;
    expect(base.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: P.save })).toBeNull();
  });

  it('turf details sends only changed keys and shows slot length read-only', async () => {
    const { calls } = mockApi([
      { method: 'PATCH', path: TURF, body: { turf: turf({ name: 'Pitch B' }) } },
      { path: TURF, body: { turf: turf() } },
      ...ownerRoutes({ permissions: [...MANAGE] }),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    const name = (await screen.findByLabelText(T.name)) as HTMLInputElement;
    const slot = screen.getByLabelText(en.owner.venues.slotLength) as HTMLInputElement;
    expect(slot.readOnly).toBe(true);
    expect(screen.getByText(T.slotLengthFixed)).toBeTruthy();
    await user.clear(name);
    await user.type(name, 'Pitch B');
    await user.click(screen.getByRole('button', { name: T.save }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toBeTruthy());
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ name: 'Pitch B' });
  });

  it('turf details are read-only without turf.manage', async () => {
    mockApi([{ path: TURF, body: { turf: turf() } }, ...ownerRoutes()]);
    renderApp(URL, { user: staffUser });
    const name = (await screen.findByLabelText(T.name)) as HTMLInputElement;
    expect(name.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: T.save })).toBeNull();
    expect(screen.queryByRole('button', { name: T.delete })).toBeNull();
  });

  it('turf delete with bookings offers deactivate', async () => {
    const { calls } = mockApi([
      { method: 'DELETE', path: TURF, status: 409, body: { error: { code: 'turf_has_bookings', message: 'x' } } },
      { method: 'PATCH', path: TURF, body: { turf: turf({ active: false }) } },
      { path: TURF, body: { turf: turf() } },
      ...ownerRoutes({ permissions: [...MANAGE] }),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: T.delete }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: T.deleteConfirm }));
    expect(await within(dialog).findByText(en.errors.turf_has_bookings)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: T.deactivate }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toBeTruthy());
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ active: false });
  });

  it('deactivating from the delete dialog updates the form and a later save does not reactivate', async () => {
    const { calls } = mockApi([
      { method: 'DELETE', path: TURF, status: 409, body: { error: { code: 'turf_has_bookings', message: 'x' } } },
      { method: 'PATCH', path: TURF, body: (c) => ({ turf: turf((c.body as { name?: string }).name ? { name: 'Pitch B', active: false } : { active: false }) }) },
      { path: TURF, body: { turf: turf() } },
      ...ownerRoutes({ permissions: [...MANAGE] }),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: T.delete }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: T.deleteConfirm }));
    await user.click(await within(dialog).findByRole('button', { name: T.deactivate }));
    await waitFor(() => expect((screen.getByLabelText(T.active) as HTMLInputElement).checked).toBe(false));
    const name = screen.getByLabelText(T.name);
    await user.clear(name);
    await user.type(name, 'Pitch B');
    await user.click(screen.getByRole('button', { name: T.save }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'PATCH')[1]!.body).toEqual({ name: 'Pitch B' });
  });

  it('turf delete success returns to the venue turfs tab', async () => {
    mockApi([
      { method: 'DELETE', path: TURF, status: 204 },
      { path: '/owners/o1/venues/v1/turfs', body: { turfs: [] } },
      { path: TURF, body: { turf: turf() } },
      ...ownerRoutes({ permissions: [...MANAGE] }),
    ]);
    const { user, location } = renderApp(URL, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: T.delete }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: T.deleteConfirm }));
    await waitFor(() => expect(location().pathname + location().search).toBe(`/owner/${OWNER_ID}/venues/v1?tab=turfs`));
  });

  it('turf hours saves a per-day diff under settings.hours', async () => {
    const { calls } = mockApi([
      { method: 'PATCH', path: TURF, body: { turf: turf({ settings: { hours: { mon: 'closed' } } }) } },
      { path: TURF, body: { turf: turf() } },
      ...ownerRoutes({ permissions: [...MANAGE] }),
    ]);
    const { user } = renderApp(`${URL}?tab=hours`, { user: staffUser });
    await user.selectOptions(await screen.findByLabelText('Monday'), 'closed');
    await user.click(screen.getByRole('button', { name: T.saveHours }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toBeTruthy());
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ settings: { hours: { mon: 'closed' } } });
  });
});
