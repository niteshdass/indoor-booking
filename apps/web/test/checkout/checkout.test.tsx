import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { MAX_SLOTS_PER_BOOKING } from '@booking/shared';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import { checkoutHref, readCheckout } from '../../src/checkout/checkoutParams';
import { money } from '../../src/lib/format';
import { mockApi, type Call } from '../helpers/api';
import { renderApp } from '../helpers/render';
import type { OfferedAddonJson, PublicUser, PublicVenue, QuoteJson, QuoteResponse } from '../../src/lib/types';

const venue: PublicVenue = {
  slug: 'arena-one',
  name: 'Arena One',
  address: 'Road 1',
  city: 'Dhaka',
  country: 'BD',
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
  location: { lat: 1, lng: 2 },
  photos: [],
  amenities: [],
  turfs: [{ id: 't1', name: 'Court A', sports: ['futsal'], indoor: true, slotLengthMin: 60 }],
};

const START = '2026-01-01T12:00:00.000Z';
const PATH = `/venues/arena-one/checkout?turf=t1&date=2026-01-01&slots=${encodeURIComponent(START)}`;

const offered: OfferedAddonJson[] = [
  { id: 'a1', name: 'Shoes', pricingType: 'per_unit', unitPrice: 150, maxQuantity: 3, autoApply: null },
  { id: 'a2', name: 'Ball', pricingType: 'per_booking', unitPrice: 100, maxQuantity: 1, autoApply: null },
  { id: 'a3', name: 'Floodlights', pricingType: 'per_hour', unitPrice: 200, maxQuantity: 1, autoApply: { outdoorOnly: false } },
];

function quote(over: Partial<QuoteJson> = {}): QuoteJson {
  return {
    currency: 'BDT',
    slots: [{ startAt: START, endAt: '2026-01-01T13:00:00.000Z', price: 2000 }],
    addons: [],
    subtotal: 2000,
    addonsTotal: 0,
    total: 2000,
    advanceRequired: 0,
    ...over,
  };
}
function qr(q: QuoteJson, guestAllowed = true): QuoteResponse {
  return { quote: q, guestAllowed, guestOtpRequired: false };
}
const player: PublicUser = { id: 'u1', name: 'Pat', email: 'p@x.com', emailVerified: true, phone: null, hasPassword: true, hasGoogle: false };

function api(quoteBody: (c: Call, n: number) => unknown) {
  return mockApi([
    { path: '/venues/arena-one', body: { venue } },
    { path: '/venues/arena-one/turfs/t1/addons', body: { currency: 'BDT', addons: offered } },
    { method: 'POST', path: '/venues/arena-one/turfs/t1/quote', body: quoteBody },
  ]);
}
const norm = (s: string) => s.replace(/\s/g, ' ');
const m = (n: number) => norm(money(n, 'BDT', 'en'));
const amount = (n: number) => (content: string) => norm(content) === m(n);
const quoteCalls = (calls: Call[]) => calls.filter((c) => c.path.endsWith('/quote'));

beforeEach(() => i18n.changeLanguage('en'));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('checkoutParams', () => {
  const p = (s: string) => new URLSearchParams(s);
  it('reads valid params, deduped and sorted', () => {
    const a = '2026-01-01T12:00:00.000Z';
    const b = '2026-01-01T13:00:00.000Z';
    expect(readCheckout(p(`turf=t1&date=2026-01-01&slots=${b},${a},${b}`))).toEqual({ turfId: 't1', date: '2026-01-01', startAts: [a, b] });
  });
  it('rejects missing or malformed params', () => {
    const ok = '2026-01-01T12:00:00.000Z';
    expect(readCheckout(p(`date=2026-01-01&slots=${ok}`))).toBeNull();
    expect(readCheckout(p(`turf=&date=2026-01-01&slots=${ok}`))).toBeNull();
    expect(readCheckout(p(`turf=t1&slots=${ok}`))).toBeNull();
    expect(readCheckout(p(`turf=t1&date=2026-02-30&slots=${ok}`))).toBeNull();
    expect(readCheckout(p(`turf=t1&date=garbage&slots=${ok}`))).toBeNull();
    expect(readCheckout(p('turf=t1&date=2026-01-01'))).toBeNull();
    expect(readCheckout(p('turf=t1&date=2026-01-01&slots='))).toBeNull();
    expect(readCheckout(p('turf=t1&date=2026-01-01&slots=nope'))).toBeNull();
    expect(readCheckout(p(`turf=t1&date=2026-01-01&slots=${ok},nope`))).toBeNull();
  });
  it('caps the slot count', () => {
    const many = Array.from({ length: MAX_SLOTS_PER_BOOKING + 1 }, (_, i) => new Date(Date.UTC(2026, 0, 1, i)).toISOString());
    expect(readCheckout(p(`turf=t1&date=2026-01-01&slots=${many.join(',')}`))).toBeNull();
    expect(readCheckout(p(`turf=t1&date=2026-01-01&slots=${many.slice(0, MAX_SLOTS_PER_BOOKING).join(',')}`))).not.toBeNull();
  });
  it('round-trips through checkoutHref', () => {
    const a = '2026-01-01T12:00:00.000Z';
    const b = '2026-01-01T13:00:00.000Z';
    const href = checkoutHref('arena one', 't 1', '2026-01-01', [a, b]);
    expect(href.startsWith('/venues/arena%20one/checkout?')).toBe(true);
    expect(readCheckout(new URLSearchParams(href.split('?')[1]))).toEqual({ turfId: 't 1', date: '2026-01-01', startAts: [a, b] });
  });
});

describe('CheckoutPage', () => {
  it('shows slots, totals and advance', async () => {
    api(() => qr(quote({ subtotal: 2000, addonsTotal: 300, total: 2300, advanceRequired: 1150 })));
    renderApp(PATH, { user: player });
    const summary = await screen.findByRole('region', { name: en.checkout.summary });
    await within(summary).findByText(amount(2300));
    expect(within(summary).getByText('18:00–19:00').closest('div')).toHaveTextContent(m(2000));
    expect(within(summary).getByText(en.checkout.addonsTotal).closest('div')).toHaveTextContent(m(300));
    expect(within(summary).getByText(en.checkout.advanceDue).closest('div')).toHaveTextContent(m(1150));
    expect(within(summary).getByText(en.checkout.payLater).closest('div')).toHaveTextContent(m(1150));
    expect(within(summary).getByRole('button', { name: /^Book and pay/ })).toHaveTextContent(m(1150));
  });

  it('omits advance rows and uses the plain label when nothing is due', async () => {
    api(() => qr(quote()));
    renderApp(PATH, { user: player });
    expect(await screen.findByRole('button', { name: en.checkout.book })).toBeInTheDocument();
    expect(screen.queryByText(en.checkout.advanceDue)).not.toBeInTheDocument();
  });

  it('auto add-on shown as included and not selectable', async () => {
    const auto = { addonId: 'a3', name: 'Floodlights', pricingType: 'per_hour' as const, unitPrice: 200, quantity: 1, minutes: 60, total: 200, auto: true };
    api(() => qr(quote({ addons: [auto], addonsTotal: 200, total: 2200 })));
    renderApp(PATH, { user: player });
    const summary = await screen.findByRole('region', { name: en.checkout.summary });
    expect(await within(summary).findByText(/Floodlights/)).toBeInTheDocument();
    expect(within(summary).getByText(en.checkout.autoAdded)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Floodlights/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Floodlights/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase Shoes' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Ball/ })).toBeInTheDocument();
  });

  it('choosing quantity re-quotes with selection', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = api(() => qr(quote()));
    const { user } = renderApp(PATH, { user: player });
    await screen.findByRole('button', { name: 'Increase Shoes' });
    await waitFor(() => expect(quoteCalls(calls)).toHaveLength(1));
    expect(quoteCalls(calls)[0]!.body).toEqual({ date: '2026-01-01', startAts: [START], addons: [] });
    await user.click(screen.getByRole('button', { name: 'Increase Shoes' }));
    await user.click(screen.getByRole('button', { name: 'Increase Shoes' }));
    expect(screen.getByRole('button', { name: 'Decrease Shoes' })).toBeEnabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await waitFor(() => expect(quoteCalls(calls)).toHaveLength(2));
    expect(quoteCalls(calls).at(-1)!.body).toEqual({ date: '2026-01-01', startAts: [START], addons: [{ addonId: 'a1', quantity: 2 }] });
    // back to zero drops the line from the body
    await user.click(screen.getByRole('button', { name: 'Decrease Shoes' }));
    await user.click(screen.getByRole('button', { name: 'Decrease Shoes' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await waitFor(() => expect(quoteCalls(calls)).toHaveLength(3));
    expect(quoteCalls(calls).at(-1)!.body).toMatchObject({ addons: [] });
  });

  it('per-booking add-on is a checkbox sending quantity 1', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = api(() => qr(quote()));
    const { user } = renderApp(PATH, { user: player });
    await user.click(await screen.findByRole('checkbox', { name: /Ball/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await waitFor(() => expect(quoteCalls(calls)).toHaveLength(2));
    expect(quoteCalls(calls).at(-1)!.body).toMatchObject({ addons: [{ addonId: 'a2', quantity: 1 }] });
  });

  it('stale quote ignored', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mocked = api((c) => qr(quote({ total: (c.body as { addons: unknown[] }).addons.length ? 2300 : 1000, subtotal: 2000 })));
    const real = globalThis.fetch;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let n = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const isQuote = String(input).endsWith('/quote');
      const first = isQuote && n++ === 0;
      const p = real(input, init);
      return first ? gate.then(() => p) : p;
    });
    const { user } = renderApp(PATH, { user: player });
    await user.click(await screen.findByRole('button', { name: 'Increase Shoes' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    const summary = screen.getByRole('region', { name: en.checkout.summary });
    await within(summary).findByText(amount(2300));
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(within(summary).getByText(amount(2300))).toBeInTheDocument();
    expect(within(summary).queryByText(amount(1000))).not.toBeInTheDocument();
    expect(mocked.unmatched).toHaveLength(0);
  });

  it('signed out + advance → sign-in required with next back to checkout', async () => {
    api(() => qr(quote({ advanceRequired: 1000 }), false));
    renderApp(PATH);
    expect(await screen.findByText(en.checkout.signInRequired)).toBeInTheDocument();
    const next = encodeURIComponent(PATH);
    const summary = screen.getByRole('region', { name: en.checkout.summary });
    expect(within(summary).getByRole('link', { name: en.checkout.signIn })).toHaveAttribute('href', `/login?next=${next}`);
    expect(within(summary).getByRole('link', { name: en.checkout.createAccount })).toHaveAttribute('href', `/register?next=${next}`);
    expect(screen.queryByRole('button', { name: en.checkout.book })).not.toBeInTheDocument();
  });

  it('signed out + guestAllowed → guest option and sign-in link', async () => {
    api(() => qr(quote(), true));
    renderApp(PATH);
    const link = await screen.findByRole('link', { name: en.checkout.signInInstead });
    expect(link).toHaveAttribute('href', `/login?next=${encodeURIComponent(PATH)}`);
    expect(screen.getByText(en.checkout.guestPlaceholder)).toBeInTheDocument();
    expect(screen.queryByText(en.checkout.signInRequired)).not.toBeInTheDocument();
  });

  it('quote error offers to choose other slots', async () => {
    api(() => ({ status: 409, body: { error: { code: 'slot_unavailable', message: 'x' } } }));
    renderApp(PATH, { user: player });
    expect(await screen.findByText(en.errors.slot_unavailable)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.checkout.chooseOtherSlots })).toHaveAttribute('href', '/venues/arena-one?turf=t1&date=2026-01-01');
    expect(screen.queryByRole('button', { name: en.checkout.book })).not.toBeInTheDocument();
  });

  it('add-on error keeps the picker usable', async () => {
    api(() => ({ status: 422, body: { error: { code: 'addon_out_of_stock', message: 'x' } } }));
    renderApp(PATH, { user: player });
    expect(await screen.findByText(en.errors.addon_out_of_stock)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase Shoes' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: en.checkout.book })).not.toBeInTheDocument();
  });

  it('malformed params → alert', async () => {
    const { unmatched } = api(() => qr(quote()));
    renderApp('/venues/arena-one/checkout?turf=t1&date=nope&slots=x');
    expect(await screen.findByText(en.checkout.invalidParams)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.checkout.backToVenue })).toHaveAttribute('href', '/venues/arena-one');
    expect(unmatched).toHaveLength(0);
  });

  it('has the new strings in ru too', () => {
    const keys = Object.keys(en.checkout).sort();
    expect(Object.keys(ru.checkout).filter((k) => !/_(one|few|many|other)$/.test(k)).sort()).toEqual(keys.filter((k) => !/_(one|few|many|other)$/.test(k)));
  });
});
