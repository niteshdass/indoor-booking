import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import type { Permission } from '../../src/owner/types';
import type { OwnerSlot, WalkInAddon } from '../../src/owner/types';
import { walkInEstimate } from '../../src/owner/walkin/walkInEstimate';
import { SlotGrid } from '../../src/venue/SlotGrid';
import { renderApp } from '../helpers/render';
import { mockApi, type Route } from '../helpers/api';
import { OWNER_ID, ownerBooking, ownerRoutes, slotDay, staffUser, turf } from './fixtures';

const NOW = '2026-10-26T04:30:00.000Z';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const SLOT_1: OwnerSlot = slotDay().slots[0]!;
const SLOT_2: OwnerSlot = {
  startAt: '2026-10-26T05:00:00.000Z',
  endAt: '2026-10-26T06:00:00.000Z',
  localStart: '11:00',
  localEnd: '12:00',
  price: 1200,
  status: 'available',
  source: 'hours',
};
const PERMS: Permission[] = ['booking.view', 'booking.create', 'payment.mark_cash'];
const URL_ = `/owner/${OWNER_ID}/walk-in?venue=v1&turf=t1&date=2026-10-26`;
const POST = '/owners/o1/venues/v1/turfs/t1/bookings';
const SLOTS = '/owners/o1/venues/v1/turfs/t1/slots';

function addon(over: Partial<WalkInAddon>): WalkInAddon {
  return { id: 'a1', name: 'Ball', pricingType: 'per_booking', unitPrice: 100, maxQuantity: 1, autoApply: null, ...over };
}

function routes(over: { perms?: Permission[]; day?: ReturnType<typeof slotDay>; post?: Partial<Route> } = {}): Route[] {
  const day = over.day ?? slotDay({ slots: [SLOT_1, SLOT_2] });
  return [
    ...ownerRoutes({ permissions: over.perms ?? PERMS }),
    { path: '/owners/o1/venues/v1/turfs', body: { turfs: [turf(), turf({ id: 't2', name: 'Pitch B', active: false })] } },
    { path: SLOTS, body: { day } },
    { path: '/owners/o1/venues/v1/turfs/t1/addons', body: { currency: 'BDT', addons: [] } },
    { method: 'POST', path: POST, status: 201, body: { booking: ownerBooking({ id: 'b9' }) }, ...over.post },
  ];
}

describe('walkInEstimate', () => {
  it('walkInEstimate sums slots and add-ons including per_hour rounding and auto lines', () => {
    const offered = [
      addon({ id: 'hr', name: 'Lights', pricingType: 'per_hour', unitPrice: 333 }),
      addon({ id: 'unit', name: 'Bibs', pricingType: 'per_unit', unitPrice: 50, maxQuantity: 5 }),
      addon({ id: 'auto', name: 'Cleaning', unitPrice: 70, autoApply: { outdoorOnly: false } }),
    ];
    const e = walkInEstimate({
      slots: [SLOT_1, SLOT_2],
      offered,
      indoor: true,
      selection: [{ addonId: 'hr' }, { addonId: 'unit', quantity: 3 }],
    });
    // lights: 333 * 120 / 60 = 666; bibs 150; auto 70
    expect(e?.slotsTotal).toBe(2200);
    expect(e?.addons.map((l) => [l.addonId, l.total])).toEqual([
      ['auto', 70],
      ['hr', 666],
      ['unit', 150],
    ]);
    expect(e?.total).toBe(2200 + 70 + 666 + 150);
  });

  it('walkInEstimate is null when a slot has no price', () => {
    expect(walkInEstimate({ slots: [{ ...SLOT_1, price: null }], offered: [], indoor: true, selection: [] })).toBeNull();
    expect(walkInEstimate({ slots: [], offered: [], indoor: true, selection: [] })).toBeNull();
  });
});

describe('SlotGrid tone', () => {
  it('SlotGrid portal tone marks selected cells without brand', () => {
    const day = { businessDate: '2026-10-26', currency: 'BDT', status: 'open' as const, slots: [SLOT_1] };
    const { unmount } = render(
      <I18nextProvider i18n={i18n}>
        <SlotGrid day={day} selected={[SLOT_1.startAt]} onToggle={() => {}} tone="portal" />
      </I18nextProvider>,
    );
    const portal = screen.getByRole('button', { name: /10:00/ }).className;
    expect(portal).toMatch(/selectedPortal/);
    expect(portal).not.toMatch(/(^|\s|_)selected_/);
    unmount();
    render(
      <I18nextProvider i18n={i18n}>
        <SlotGrid day={day} selected={[SLOT_1.startAt]} onToggle={() => {}} />
      </I18nextProvider>,
    );
    const brand = screen.getByRole('button', { name: /10:00/ }).className;
    expect(brand).toMatch(/selected/);
    expect(brand).not.toMatch(/selectedPortal/);
  });
});

describe('Walk-in page', () => {
  it('prefilled slot from the schedule is selected', async () => {
    mockApi(routes());
    renderApp(`${URL_}&start=${encodeURIComponent(SLOT_2.startAt)}`, { user: staffUser });
    const cell = await screen.findByRole('button', { name: /11:00/ });
    await waitFor(() => expect(cell.getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: /10:00/ }).getAttribute('aria-pressed')).toBe('false');
    expect(await screen.findByText(en.owner.walkIn.estimate)).toBeTruthy();
  });

  it('cash option hidden without payment.mark_cash', async () => {
    mockApi(routes({ perms: ['booking.view', 'booking.create'] }));
    renderApp(URL_, { user: staffUser });
    await screen.findByRole('button', { name: /10:00/ });
    expect(screen.getByRole('radio', { name: en.owner.walkIn.link })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: en.owner.walkIn.cash })).toBeNull();
  });

  async function fillAndPick(user: ReturnType<typeof renderApp>['user']) {
    await user.click(await screen.findByRole('button', { name: /10:00/ }));
    await user.type(screen.getByLabelText(en.owner.walkIn.name), 'Ada Walker');
    await user.type(screen.getByLabelText(en.auth.phone.number), '1712345678');
  }

  it('submit sends exactly the documented body and opens booking detail', async () => {
    const api = mockApi(routes());
    const { user, location } = renderApp(URL_, { user: staffUser });
    await fillAndPick(user);
    await user.click(screen.getByRole('button', { name: en.owner.walkIn.submit }));
    await waitFor(() => expect(location().pathname).toBe(`/owner/${OWNER_ID}/bookings/b9`));
    expect(api.calls.find((c) => c.path === POST)!.body).toEqual({
      date: '2026-10-26',
      startAts: [SLOT_1.startAt],
      addons: [],
      customer: { name: 'Ada Walker', phone: '+8801712345678' },
      payment: { method: 'unpaid' },
    });
  });

  it('cash amount is sent only when edited', async () => {
    const api = mockApi(routes());
    const { user } = renderApp(URL_, { user: staffUser });
    await fillAndPick(user);
    await user.click(screen.getByRole('radio', { name: en.owner.walkIn.cash }));
    const amount = screen.getByLabelText(en.owner.walkIn.cashAmount) as HTMLInputElement;
    expect(amount.value).toBe('10.00');
    await user.click(screen.getByRole('button', { name: en.owner.walkIn.submit }));
    await waitFor(() => expect(api.calls.filter((c) => c.path === POST)).toHaveLength(1));
    expect((api.calls.find((c) => c.path === POST)!.body as { payment: unknown }).payment).toEqual({ method: 'cash' });
  });

  it('link payment shows the QR dialog then goes to detail', async () => {
    const api = mockApi(
      routes({
        post: { body: { booking: ownerBooking({ id: 'b9' }), payment: { id: 'p1', amount: 1000, currency: 'BDT', url: 'https://pay.example/x' } } },
      }),
    );
    const { user, location } = renderApp(URL_, { user: staffUser });
    await fillAndPick(user);
    await user.click(screen.getByRole('radio', { name: en.owner.walkIn.link }));
    await user.click(screen.getByRole('button', { name: en.owner.walkIn.submit }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText(en.owner.link.url) as HTMLInputElement).value).toBe('https://pay.example/x');
    expect(location().pathname).toBe('/owner/o1/walk-in');
    expect((api.calls.find((c) => c.path === POST)!.body as { payment: unknown }).payment).toEqual({ method: 'link' });
    await user.click(within(dialog).getByRole('button', { name: en.owner.link.close }));
    await waitFor(() => expect(location().pathname).toBe(`/owner/${OWNER_ID}/bookings/b9`));
    expect(api.calls.some((c) => c.path.endsWith('/payments/link'))).toBe(false);
  });

  it('walk-in slot_taken keeps the form and refetches slots', async () => {
    const taken = slotDay({ slots: [{ ...SLOT_1, status: 'booked' }, SLOT_2] });
    const all: Route[] = routes({ post: { status: 409, body: { error: { code: 'slot_taken', message: 'x' } } } });
    let n = 0;
    const api = mockApi(all.map((r) => (r.path === SLOTS ? { ...r, body: () => ({ day: n++ === 0 ? slotDay({ slots: [SLOT_1, SLOT_2] }) : taken }) } : r)));
    const { user, location } = renderApp(URL_, { user: staffUser });
    await fillAndPick(user);
    await user.click(screen.getByRole('button', { name: en.owner.walkIn.submit }));
    expect(await screen.findByText(en.errors.slot_taken)).toBeTruthy();
    expect((screen.getByLabelText(en.owner.walkIn.name) as HTMLInputElement).value).toBe('Ada Walker');
    await waitFor(() => expect(api.calls.filter((c) => c.path === SLOTS)).toHaveLength(2));
    await waitFor(() => expect((screen.getByRole('button', { name: /10:00/ }) as HTMLButtonElement).disabled).toBe(true));
    expect(location().pathname).toBe('/owner/o1/walk-in');
  });

  it('outside the booking window disables submit', async () => {
    mockApi(routes({ day: slotDay({ inWindow: false }) }));
    renderApp(URL_, { user: staffUser });
    expect(await screen.findByText(en.owner.walkIn.outsideWindow)).toBeTruthy();
    expect((screen.getByRole('button', { name: en.owner.walkIn.submit }) as HTMLButtonElement).disabled).toBe(true);
  });
});
