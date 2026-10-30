import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { MAX_BOOKINGS_PER_GROUP, MAX_SLOTS_PER_BOOKING } from '@booking/shared';
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
  rating: null,
  turfs: [{ id: 't1', name: 'Court A', sports: ['futsal'], indoor: true, slotLengthMin: 60 }],
};

const START = '2026-01-01T12:00:00.000Z';
const PATH = `/venues/arena-one/checkout?turf=t1&date=2026-01-01&slots=${encodeURIComponent(START)}`;
const MORE2 = '2026-01-02:2026-01-02T09:00:00.000Z';
const MORE3 = '2026-01-03:2026-01-03T15:00:00.000Z';

const offered: OfferedAddonJson[] = [
  { id: 'a1', name: 'Shoes', pricingType: 'per_unit', unitPrice: 150, maxQuantity: 3, autoApply: null },
  { id: 'a2', name: 'Ball', pricingType: 'per_booking', unitPrice: 100, maxQuantity: 1, autoApply: null },
  { id: 'a4', name: 'Racket', pricingType: 'per_hour', unitPrice: 50, maxQuantity: 5, autoApply: null },
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
function qr(q: QuoteJson, guestAllowed = true, paymentMethods?: QuoteResponse['paymentMethods']): QuoteResponse {
  return { quote: q, guestAllowed, guestOtpRequired: false, ...(paymentMethods && { paymentMethods }) };
}
const player: PublicUser = { id: 'u1', name: 'Pat', email: 'p@x.com', emailVerified: true, phone: null, hasPassword: true, hasGoogle: false, platformAdmin: false };

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
    expect(readCheckout(p(`turf=t1&date=2026-01-01&slots=${b},${a},${b}`))).toEqual({ turfId: 't1', date: '2026-01-01', startAts: [a, b], more: [] });
  });
  it('reads more bookings, each with its own day and times', () => {
    const a = '2026-01-01T12:00:00.000Z';
    const c = '2026-01-03T09:00:00.000Z';
    const d = '2026-01-03T11:00:00.000Z';
    expect(readCheckout(p(`turf=t1&date=2026-01-01&slots=${a}&more=2026-01-03:${d},${c};2026-01-03:${d}`))?.more).toEqual([
      { date: '2026-01-03', startAts: [c, d] },
      { date: '2026-01-03', startAts: [d] },
    ]);
    expect(readCheckout(p(`turf=t1&date=2026-01-01&slots=${a}&more=2026-01-02`))).toBeNull();
    expect(readCheckout(p(`turf=t1&date=2026-01-01&slots=${a}&more=nope:${c}`))).toBeNull();
    expect(readCheckout(p(`turf=t1&date=2026-01-01&slots=${a}&more=2026-01-03:nope`))).toBeNull();
    const many = Array.from({ length: MAX_BOOKINGS_PER_GROUP }, () => `2026-01-03:${c}`);
    expect(readCheckout(p(`turf=t1&date=2026-01-01&slots=${a}&more=${many.join(';')}`))).toBeNull();
    expect(readCheckout(p(`turf=t1&date=2026-01-01&slots=${a}&more=${many.slice(1).join(';')}`))).not.toBeNull();
  });
  it('reads more bookings on other courts, and writes them back', () => {
    const a = '2026-01-01T12:00:00.000Z';
    const c = '2026-01-03T09:00:00.000Z';
    const more = [{ turfId: 't2', date: '2026-01-03', startAts: [c] }, { turfId: 't1', date: '2026-01-03', startAts: [c] }];
    const href = checkoutHref('arena-one', 't1', '2026-01-01', [a], more);
    expect(new URL(href, 'http://x').searchParams.get('more')).toBe(`2026-01-03@t2:${c};2026-01-03:${c}`);
    expect(readCheckout(new URL(href, 'http://x').searchParams)?.more).toEqual([{ turfId: 't2', date: '2026-01-03', startAts: [c] }, { date: '2026-01-03', startAts: [c] }]);
    expect(readCheckout(p(`turf=t1&date=2026-01-01&slots=${a}&more=2026-01-03@:${c}`))).toBeNull();
    expect(readCheckout(p(`turf=t1&date=2026-01-01&slots=${a}&more=2026-01-03@t%2F2:${c}`))).toBeNull();
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
    expect(readCheckout(new URLSearchParams(href.split('?')[1]))).toEqual({ turfId: 't 1', date: '2026-01-01', startAts: [a, b], more: [] });
    const more = [{ date: '2026-01-02', startAts: ['2026-01-02T09:00:00.000Z'] }, { date: '2026-01-03', startAts: [a.replace('01T', '03T'), b.replace('01T', '03T')] }];
    const many = checkoutHref('arena-one', 't1', '2026-01-01', [a], more);
    expect(readCheckout(new URLSearchParams(many.split('?')[1]))?.more).toEqual(more);
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

  it('summary shows how to pay before Continue', async () => {
    api(() => qr(quote({ total: 2000, advanceRequired: 50000 }), false, { wallets: ['bkash'], card: true }));
    renderApp(PATH, { user: player });
    const summary = await screen.findByRole('region', { name: en.checkout.summary });
    const line = await within(summary).findByText((c) => norm(c).startsWith('Pay ') && norm(c).includes(' now by '));
    expect(norm(line.textContent ?? '')).toBe(`Pay ${m(50000)} now by bKash or card · rest at venue`);
  });

  it('no online method disables Continue and says why', async () => {
    api(() => qr(quote({ advanceRequired: 500 }), false, { wallets: [], card: false }));
    renderApp(PATH, { user: player });
    expect(await screen.findByText(en.checkout.noMethods)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Book and pay/ })).toBeDisabled();
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

  it('per-hour add-on is a checkbox sending quantity 1, not a stepper', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = api(() => qr(quote()));
    const { user } = renderApp(PATH, { user: player });
    const box = await screen.findByRole('checkbox', { name: /Racket/ });
    expect(screen.queryByRole('button', { name: 'Increase Racket' })).not.toBeInTheDocument();
    await user.click(box);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await waitFor(() => expect(quoteCalls(calls)).toHaveLength(2));
    expect(quoteCalls(calls).at(-1)!.body).toMatchObject({ addons: [{ addonId: 'a4', quantity: 1 }] });
  });

  it('sends the first quote immediately, without the debounce', async () => {
    vi.useFakeTimers();
    const { calls } = api(() => qr(quote()));
    renderApp(PATH, { user: player });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(quoteCalls(calls)).toHaveLength(1);
  });

  it('add-ons fetch failure shows a notice and booking still works', async () => {
    mockApi([
      { path: '/venues/arena-one', body: { venue } },
      { path: '/venues/arena-one/turfs/t1/addons', status: 500, body: { error: { code: 'internal', message: 'x' } } },
      { method: 'POST', path: '/venues/arena-one/turfs/t1/quote', body: qr(quote()) },
    ]);
    renderApp(PATH, { user: player });
    expect(await screen.findByText(en.checkout.addonsUnavailable)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: en.checkout.book })).toBeInTheDocument();
  });

  it('disables the CTA while a re-quote is pending', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api(() => qr(quote()));
    const { user } = renderApp(PATH, { user: player });
    const book = await screen.findByRole('button', { name: en.checkout.book });
    await waitFor(() => expect(book).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Increase Shoes' }));
    expect(screen.getByRole('button', { name: en.checkout.book })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.checkout.book })).toHaveAttribute('aria-disabled', 'true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: en.checkout.book })).toBeEnabled());
  });

  it('signed out, guests disabled, no advance → neutral account message', async () => {
    api(() => qr(quote({ advanceRequired: 0 }), false));
    renderApp(PATH);
    expect(await screen.findByText(en.checkout.accountRequired)).toBeInTheDocument();
    expect(screen.queryByText(en.checkout.signInRequired)).not.toBeInTheDocument();
  });

  it('per-hour line shows billed duration; per-booking has no multiplier', async () => {
    const lines = [
      { addonId: 'a4', name: 'Racket', pricingType: 'per_hour' as const, unitPrice: 50, quantity: 1, minutes: 90, total: 75, auto: false },
      { addonId: 'a2', name: 'Ball', pricingType: 'per_booking' as const, unitPrice: 100, quantity: 1, minutes: null, total: 100, auto: false },
    ];
    api(() => qr(quote({ addons: lines, addonsTotal: 175, total: 2175 })));
    renderApp(PATH, { user: player });
    const summary = await screen.findByRole('region', { name: en.checkout.summary });
    expect(await within(summary).findByText(/Racket · 1 h 30 min/)).toBeInTheDocument();
    expect(within(summary).getByText('Ball')).toBeInTheDocument();
    expect(within(summary).queryByText(/×/)).not.toBeInTheDocument();
  });

  it('unknown venue shows not found', async () => {
    mockApi([{ path: '/venues/arena-one', status: 404, body: { error: { code: 'not_found', message: 'x' } } }, { path: /.*/, body: {} }]);
    renderApp(PATH, { user: player });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByRole('region', { name: en.checkout.summary })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: en.checkout.title })).not.toBeInTheDocument();
  });

  it('invalid_quantity keeps the picker usable', async () => {
    api(() => ({ status: 422, body: { error: { code: 'invalid_quantity', message: 'x' } } }));
    renderApp(PATH, { user: player });
    expect(await screen.findByText(en.errors.invalid_quantity)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase Shoes' })).toBeEnabled();
    expect(screen.queryByRole('link', { name: en.checkout.chooseOtherSlots })).not.toBeInTheDocument();
  });

  it('malformed params → alert', async () => {
    const { unmatched } = api(() => qr(quote()));
    renderApp('/venues/arena-one/checkout?turf=t1&date=nope&slots=x');
    expect(await screen.findByText(en.checkout.invalidParams)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.checkout.backToVenue })).toHaveAttribute('href', '/venues/arena-one');
    expect(unmatched).toHaveLength(0);
  });

  it('several bookings: one row each with its day and times, group total and advance, more in the quote body', async () => {
    const item = (date: string) => ({ date, quote: quote({ advanceRequired: 400 }) });
    const { calls } = api(() => ({
      ...qr(quote({ advanceRequired: 400 }), false),
      items: [item('2026-01-01'), item('2026-01-02'), item('2026-01-03')],
      total: 6000,
      advanceRequired: 1200,
    }));
    renderApp(`${PATH}&more=${MORE2};${MORE3}`, { user: player });
    const summary = await screen.findByRole('region', { name: en.checkout.summary });
    expect(await within(summary).findByText(amount(6000))).toBeInTheDocument();
    expect(within(summary).getAllByText(amount(2000))).toHaveLength(3);
    expect(within(summary).getByText(/3 bookings/)).toBeInTheDocument();
    expect(within(summary).getAllByText(/\d{2}:\d{2}–\d{2}:\d{2}/)).toHaveLength(3);
    expect(norm(screen.getByRole('button', { name: /Book and pay/ }).textContent ?? '')).toContain(m(1200));
    expect(quoteCalls(calls)[0]!.body).toMatchObject({
      more: [
        { date: '2026-01-02', startAts: [MORE2.slice(11)] },
        { date: '2026-01-03', startAts: [MORE3.slice(11)] },
      ],
    });
  });

  it('several bookings signed out asks for an account', async () => {
    api(() => ({ ...qr(quote(), false), items: [{ date: '2026-01-01', quote: quote() }, { date: '2026-01-02', quote: quote() }], total: 4000, advanceRequired: 0 }));
    renderApp(`${PATH}&more=${MORE2}`);
    expect(await screen.findByText(en.checkout.groupSignIn)).toBeInTheDocument();
    expect(screen.queryByText(en.checkout.guestPlaceholder)).not.toBeInTheDocument();
  });

  it('a quote error on one booking offers to drop just that one', async () => {
    const { calls } = api((c) =>
      (c.body as { more?: unknown[] }).more
        ? { status: 409, body: { error: { code: 'slot_taken', message: 'x', details: { date: '2026-01-02', itemStart: MORE2.slice(11) } } } }
        : qr(quote()),
    );
    const { user, location } = renderApp(`${PATH}&more=${MORE2}`, { user: player });
    const remove = await screen.findByRole('button', { name: /Remove/ });
    await user.click(remove);
    await waitFor(() => expect(new URLSearchParams(location().search).get('more')).toBeNull());
    expect(await screen.findByRole('button', { name: en.checkout.book })).toBeInTheDocument();
    expect(quoteCalls(calls).at(-1)!.body).not.toHaveProperty('more');
  });

  it('dropping the first booking makes the next one first', async () => {
    api((c) =>
      (c.body as { more?: unknown[] }).more
        ? { status: 409, body: { error: { code: 'slot_taken', message: 'x', details: { date: '2026-01-01', itemStart: START } } } }
        : qr(quote()),
    );
    const { user, location } = renderApp(`${PATH}&more=${MORE2}`, { user: player });
    await user.click(await screen.findByRole('button', { name: /Remove/ }));
    await waitFor(() => expect(new URLSearchParams(location().search).get('date')).toBe('2026-01-02'));
    expect(new URLSearchParams(location().search).get('slots')).toBe(MORE2.slice(11));
  });

  it('has the new strings in ru too', () => {
    expect(Object.keys(ru.addons).sort()).toEqual(Object.keys(en.addons).sort());
    for (const k of ['addon_unavailable', 'addon_auto', 'invalid_quantity', 'addon_out_of_stock', 'too_many_slots']) {
      expect(ru.errors).toHaveProperty(k);
    }
    const keys = Object.keys(en.checkout).sort();
    expect(Object.keys(ru.checkout).filter((k) => !/_(one|few|many|other)$/.test(k)).sort()).toEqual(keys.filter((k) => !/_(one|few|many|other)$/.test(k)));
  });
});
