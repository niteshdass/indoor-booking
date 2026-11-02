import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import { mockApi } from '../helpers/api';
import { setAccessToken } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import type { BookingJson, PublicUser, SlotDay, SlotJson } from '../../src/lib/types';
import { runOfLength } from '../../src/venue/slotSelection';

const player: PublicUser = { id: 'u1', name: 'Pat', email: 'p@x.com', emailVerified: true, phone: null, hasPassword: true, hasGoogle: false, platformAdmin: false };

// Two one-hour slots, 18:00–20:00 in Dhaka on 26 Oct.
const booking = (over: Partial<BookingJson> = {}) =>
  ({
    id: 'b1',
    reference: 'AB12CD',
    venueId: 'v1',
    turfId: 't1',
    businessDate: '2026-10-26',
    slots: [
      { startAt: '2026-10-26T12:00:00.000Z', endAt: '2026-10-26T13:00:00.000Z', price: 1000 },
      { startAt: '2026-10-26T13:00:00.000Z', endAt: '2026-10-26T14:00:00.000Z', price: 1000 },
    ],
    addons: [],
    currency: 'BDT',
    subtotal: 2000,
    addonsTotal: 0,
    total: 2000,
    advanceRequired: 0,
    amountPaid: 0,
    amountRefunded: 0,
    status: 'confirmed',
    paymentStatus: 'unpaid',
    holdExpiresAt: null,
    source: 'online',
    playerId: 'u1',
    guest: null,
    completedAt: null,
    review: null,
    reviewableUntil: null,
    rescheduleCount: 0,
    rescheduledAt: null,
    reschedulableUntil: '2026-10-25T12:00:00.000Z',
    venue: { slug: 'arena-one', name: 'Arena One', address: 'x', city: 'Dhaka', timezone: 'Asia/Dhaka' },
    turf: { name: 'Turf A' },
    ...over,
  }) as BookingJson;

const slot = (hourUtc: number, over: Partial<SlotJson> = {}): SlotJson => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    startAt: `2026-10-26T${pad(hourUtc)}:00:00.000Z`,
    endAt: `2026-10-26T${pad(hourUtc + 1)}:00:00.000Z`,
    localStart: `${pad(hourUtc + 6)}:00`,
    localEnd: `${pad(hourUtc + 7)}:00`,
    price: 1000,
    status: 'available',
    ...over,
  };
};

// 16:00–22:00 local; the booking's own 18:00 and 19:00 show as booked, 21:00 is taken by someone else.
const day = (over: Partial<SlotDay> = {}): SlotDay => ({
  businessDate: '2026-10-26',
  currency: 'BDT',
  status: 'open',
  slots: [slot(10), slot(11), slot(12, { status: 'booked' }), slot(13, { status: 'booked' }), slot(14), slot(15, { status: 'booked' })],
  ...over,
});

const SLOTS = '/venues/arena-one/turfs/t1/slots';
const errBody = (code: string) => ({ error: { code, message: code } });
const R = en.reschedule;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T06:00:00.000Z'));
  setAccessToken(null);
  return i18n.changeLanguage('en');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const cell = (scope: HTMLElement, local: string) => within(scope).getByRole('button', { name: new RegExp(`^${local}`) });

describe('player change time', () => {
  it('is offered only while reschedulableUntil is set', async () => {
    mockApi([{ path: '/me/bookings/b1', body: { booking: booking({ reschedulableUntil: null }), refunds: [] } }]);
    renderApp('/me/bookings/b1', { user: player });
    expect(await screen.findByText('AB12CD')).toBeTruthy();
    expect(screen.queryByRole('button', { name: R.open })).toBeNull();
    expect(screen.queryByText(/You can change the time until/)).toBeNull();
  });

  it('shows the hint and posts the new date and starts, then shows the moved booking', async () => {
    const moved = booking({
      slots: [
        { startAt: '2026-10-26T10:00:00.000Z', endAt: '2026-10-26T11:00:00.000Z', price: 1000 },
        { startAt: '2026-10-26T11:00:00.000Z', endAt: '2026-10-26T12:00:00.000Z', price: 1000 },
      ],
      rescheduleCount: 1,
      rescheduledAt: '2026-10-24T06:00:00.000Z',
      reschedulableUntil: null,
    });
    const api = mockApi([
      { method: 'POST', path: '/me/bookings/b1/reschedule', body: { booking: moved } },
      { path: SLOTS, body: { day: day() } },
      { path: '/me/bookings/b1', body: { booking: booking(), refunds: [] } },
    ]);
    const { user } = renderApp('/me/bookings/b1', { user: player });
    // 12:00Z is 18:00 in Dhaka.
    expect(await screen.findByText(/You can change the time until .*18:00/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: R.open }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(R.priceKept)).toBeTruthy();
    await waitFor(() => expect(within(dialog).getAllByRole('button', { name: /^16:00/ })).toHaveLength(1));
    const confirm = within(dialog).getByRole('button', { name: R.confirm });
    expect(confirm).toBeDisabled();
    // One tap picks two slots in a row: 16:00 and 17:00.
    await user.click(cell(dialog, '16:00'));
    expect(cell(dialog, '16:00')).toHaveAttribute('aria-pressed', 'true');
    expect(cell(dialog, '17:00')).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByText(/16:00–18:00/)).toBeTruthy();
    await user.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = api.calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ date: '2026-10-26', startAts: ['2026-10-26T10:00:00.000Z', '2026-10-26T11:00:00.000Z'] });
    expect(api.calls.find((c) => c.path === SLOTS)!.query.get('date')).toBe('2026-10-26');
    expect(screen.getByText(/^Time changed on /)).toBeTruthy();
    expect(screen.queryByRole('button', { name: R.open })).toBeNull();
  });

  it('lets the booking shift onto its own slots, but not stay where it is', async () => {
    mockApi([
      { path: SLOTS, body: { day: day() } },
      { path: '/me/bookings/b1', body: { booking: booking(), refunds: [] } },
    ]);
    const { user } = renderApp('/me/bookings/b1', { user: player });
    await user.click(await screen.findByRole('button', { name: R.open }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(cell(dialog, '18:00')).toBeEnabled());
    await user.click(cell(dialog, '18:00'));
    expect(within(dialog).getByText(R.sameTime)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: R.confirm })).toBeDisabled();
    // 19:00–21:00: one of its own slots plus the free 20:00.
    await user.click(cell(dialog, '18:00'));
    await user.click(cell(dialog, '19:00'));
    expect(within(dialog).queryByText(R.sameTime)).toBeNull();
    expect(within(dialog).getByRole('button', { name: R.confirm })).toBeEnabled();
  });

  it('blocks slots that cost more than the booking', async () => {
    mockApi([
      { path: SLOTS, body: { day: day({ slots: [slot(10, { price: 1500 }), slot(11, { price: 1500 }), slot(12, { status: 'booked' }), slot(13, { status: 'booked' })] }) } },
      { path: '/me/bookings/b1', body: { booking: booking(), refunds: [] } },
    ]);
    const { user } = renderApp('/me/bookings/b1', { user: player });
    await user.click(await screen.findByRole('button', { name: R.open }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(cell(dialog, '16:00')).toBeEnabled());
    await user.click(cell(dialog, '16:00'));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/cost more/);
    expect(within(dialog).getByRole('button', { name: R.confirm })).toBeDisabled();
  });

  it.each(['reschedule_too_late', 'reschedule_price_higher', 'slot_taken'] as const)('a %s refusal shows its message', async (code) => {
    const api = mockApi([
      { method: 'POST', path: '/me/bookings/b1/reschedule', status: 409, body: errBody(code) },
      { path: SLOTS, body: { day: day() } },
      { path: '/me/bookings/b1', body: { booking: booking(), refunds: [] } },
    ]);
    const { user } = renderApp('/me/bookings/b1', { user: player });
    await user.click(await screen.findByRole('button', { name: R.open }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(cell(dialog, '16:00')).toBeEnabled());
    await user.click(cell(dialog, '16:00'));
    await user.click(within(dialog).getByRole('button', { name: R.confirm }));
    expect(await within(dialog).findByText(en.errors[code])).toBeTruthy();
    if (code === 'reschedule_too_late') expect(within(dialog).queryByRole('button', { name: R.confirm })).toBeNull();
    if (code === 'slot_taken') {
      // The grid is re-read and the pick cleared.
      await waitFor(() => expect(api.calls.filter((c) => c.path === SLOTS)).toHaveLength(2));
      expect(within(dialog).getByRole('button', { name: R.confirm })).toBeDisabled();
    }
  });
});

describe('runOfLength', () => {
  const slots = [slot(10), slot(11), slot(12), slot(13, { status: 'booked' }), slot(14)];
  const starts = (r: SlotJson[] | null) => r?.map((s) => s.localStart) ?? null;

  it('starts at the tapped slot when the run fits', () => {
    expect(starts(runOfLength(slots, slots[0]!.startAt, 2))).toEqual(['16:00', '17:00']);
  });

  it('ends on the tapped slot when nothing free follows it', () => {
    expect(starts(runOfLength(slots, slots[2]!.startAt, 2))).toEqual(['17:00', '18:00']);
  });

  it('is null when no free run holds the tapped slot', () => {
    expect(runOfLength(slots, slots[4]!.startAt, 2)).toBeNull();
    expect(runOfLength(slots, slots[3]!.startAt, 1)).toBeNull();
  });

  it('does not bridge a gap in time', () => {
    const gap = [slot(10), slot(12)];
    expect(runOfLength(gap, gap[0]!.startAt, 2)).toBeNull();
  });
});
