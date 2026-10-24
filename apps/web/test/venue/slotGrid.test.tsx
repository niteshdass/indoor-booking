import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import { money } from '../../src/lib/format';
import { SlotGrid } from '../../src/venue/SlotGrid';
import { mockApi } from '../helpers/api';
import { renderApp } from '../helpers/render';
import type { PublicVenue, SlotDay, SlotJson } from '../../src/lib/types';

beforeEach(() => i18n.changeLanguage('en'));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function slot(i: number, status: SlotJson['status'] = 'available', price: number | null = 1500): SlotJson {
  const start = Date.parse('2026-10-25T04:00:00Z') + i * 3_600_000;
  const hh = (n: number) => `${String(10 + n).padStart(2, '0')}:00`;
  return {
    startAt: new Date(start).toISOString(),
    endAt: new Date(start + 3_600_000).toISOString(),
    localStart: hh(i),
    localEnd: hh(i + 1),
    price,
    status,
  };
}

function day(slots: SlotJson[], status: SlotDay['status'] = 'open'): SlotDay {
  return { businessDate: '2026-10-25', currency: 'BDT', status, slots };
}

function renderGrid(d: SlotDay, selected: string[] = [], onToggle = vi.fn()) {
  render(
    <I18nextProvider i18n={i18n}>
      <SlotGrid day={d} selected={selected} onToggle={onToggle} />
    </I18nextProvider>,
  );
  return onToggle;
}

describe('SlotGrid', () => {
  it('pending is distinct from booked', () => {
    renderGrid(day([slot(0, 'pending'), slot(1, 'booked')]));
    const pending = screen.getByRole('button', { name: new RegExp(en.slots.pending) });
    const booked = screen.getByRole('button', { name: new RegExp(en.slots.booked) });
    expect(pending).toHaveAttribute('aria-label', expect.stringContaining(en.slots.pending));
    expect(booked).toHaveAttribute('aria-label', expect.stringContaining(en.slots.booked));
    expect(pending).toBeDisabled();
    expect(booked).toBeDisabled();
    expect(pending.className).not.toBe(booked.className);
  });

  it('available click calls onToggle; selected is pressed; null price is disabled', async () => {
    const s0 = slot(0);
    const onToggle = renderGrid(day([s0, slot(1), slot(2, 'available', null)]), [s0.startAt]);
    expect(screen.getByRole('button', { name: /10:00/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /11:00/ }));
    expect(onToggle).toHaveBeenCalledWith(slot(1).startAt);
    expect(screen.getByRole('button', { name: /12:00/ })).toBeDisabled();
  });

  it('blocked and past cells are disabled with state in the label', () => {
    renderGrid(day([slot(0, 'blocked'), slot(1, 'past')]));
    const blocked = screen.getByRole('button', { name: new RegExp(en.slots.blocked) });
    const past = screen.getByRole('button', { name: new RegExp(en.slots.past) });
    expect(blocked).toBeDisabled();
    expect(past).toBeDisabled();
    expect(blocked).toHaveAttribute('aria-label', expect.stringContaining(en.slots.blocked));
    expect(past).toHaveAttribute('aria-label', expect.stringContaining(en.slots.past));
  });

  it('closed day message', () => {
    renderGrid(day([], 'closed'));
    expect(screen.getByText(en.slots.closed)).toBeInTheDocument();
  });

  it('outside window message', () => {
    renderGrid(day([], 'outside_window'));
    expect(screen.getByText(en.slots.outsideWindow)).toBeInTheDocument();
  });

  it('no slots message', () => {
    renderGrid(day([]));
    expect(screen.getByText(en.slots.none)).toBeInTheDocument();
  });

  it('has a legend', () => {
    renderGrid(day([slot(0)]));
    const legend = screen.getByRole('list', { name: en.slots.legend });
    for (const k of ['available', 'selected', 'pending', 'booked', 'blocked'] as const) {
      expect(within(legend).getByText(en.slots[k])).toBeInTheDocument();
    }
  });
});

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

describe('VenuePage slots', () => {
  const slots = [slot(0), slot(1), slot(2, 'booked')];
  const routes = () => [
    { path: '/venues/arena-one', body: { venue } },
    { path: '/venues/arena-one/turfs/t1/slots', body: (c: { query: URLSearchParams }) => ({ day: { ...day(slots), businessDate: c.query.get('date') } }) },
  ];

  it('selecting two slots shows count and total then continue links to checkout with both startAts', async () => {
    vi.setSystemTime(new Date('2026-10-24T06:00:00Z'));
    const { calls } = mockApi(routes());
    const { user } = renderApp('/venues/arena-one?date=2026-10-25');
    await user.click(await screen.findByRole('button', { name: /10:00/ }));
    await user.click(screen.getByRole('button', { name: /11:00/ }));
    const bar = screen.getByRole('complementary', { name: en.slots.summary });
    expect(within(bar).getByText('2 slots')).toBeInTheDocument();
    expect(screen.getByText('10:00–12:00')).toBeInTheDocument();
    const squash = (s: string) => s.replace(/\s/g, '');
    expect(squash(screen.getByRole('complementary', { name: en.slots.summary }).textContent ?? '')).toContain(squash(money(3000, 'BDT', 'en')));
    const link = screen.getByRole('link', { name: en.slots.continue });
    const href = new URL(link.getAttribute('href')!, 'http://x');
    expect(href.pathname).toBe('/venues/arena-one/checkout');
    expect(href.searchParams.get('turf')).toBe('t1');
    expect(href.searchParams.get('date')).toBe('2026-10-25');
    expect(href.searchParams.get('slots')).toBe(`${slot(0).startAt},${slot(1).startAt}`);
    expect(calls.some((c) => c.path.endsWith('/turfs/t1/slots') && c.query.get('date') === '2026-10-25')).toBe(true);
  });

  it('changing date clears selection', async () => {
    vi.setSystemTime(new Date('2026-10-24T06:00:00Z'));
    mockApi(routes());
    const { user } = renderApp('/venues/arena-one?date=2026-10-25');
    await user.click(await screen.findByRole('button', { name: /10:00/ }));
    expect(screen.getByRole('link', { name: en.slots.continue })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Oct 27/ }));
    await waitFor(() => expect(screen.queryByRole('link', { name: en.slots.continue })).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /10:00/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('slot fetch error shows alert with retry and no selection bar', async () => {
    vi.setSystemTime(new Date('2026-10-24T06:00:00Z'));
    mockApi([
      { path: '/venues/arena-one', body: { venue } },
      { path: '/venues/arena-one/turfs/t1/slots', status: 500, body: { error: { code: 'internal', message: 'x' } } },
    ]);
    renderApp('/venues/arena-one?date=2026-10-25');
    expect(await screen.findByText(en.errors.generic)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.search.retry })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: en.slots.continue })).not.toBeInTheDocument();
  });

  it('has Russian plural forms for selectedCount', () => {
    const r = ru.slots as Record<string, string>;
    for (const f of ['one', 'few', 'many', 'other']) expect(r[`selectedCount_${f}`]).toBeTruthy();
  });

  it('side card is rendered with a hint before any selection', async () => {
    vi.setSystemTime(new Date('2026-10-24T06:00:00Z'));
    mockApi(routes());
    renderApp('/venues/arena-one?date=2026-10-25');
    await screen.findByRole('button', { name: /10:00/ });
    expect(screen.getByText(en.slots.pickHint)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: en.slots.continue })).not.toBeInTheDocument();
  });

  it('keeps a persistent polite live region whose text follows the selection', async () => {
    vi.setSystemTime(new Date('2026-10-24T06:00:00Z'));
    mockApi(routes());
    const { user } = renderApp('/venues/arena-one?date=2026-10-25');
    await screen.findByRole('button', { name: /10:00/ });
    const live = document.querySelector('[aria-live="polite"]')!;
    expect(live).toHaveTextContent('');
    await user.click(screen.getByRole('button', { name: /10:00/ }));
    expect(document.querySelector('[aria-live="polite"]')).toBe(live);
    expect(live).toHaveTextContent('1 slot');
  });

  it('renders Russian plurals for 2 and 5 slots', async () => {
    vi.setSystemTime(new Date('2026-10-24T06:00:00Z'));
    const five = [0, 1, 2, 3, 4].map((i) => slot(i));
    mockApi([
      { path: '/venues/arena-one', body: { venue } },
      { path: '/venues/arena-one/turfs/t1/slots', body: { day: day(five) } },
    ]);
    await i18n.changeLanguage('ru');
    const { user } = renderApp('/venues/arena-one?date=2026-10-25');
    await user.click(await screen.findByRole('button', { name: /10:00/ }));
    await user.click(screen.getByRole('button', { name: /11:00/ }));
    const bar = screen.getByRole('complementary', { name: ru.slots.summary });
    expect(within(bar).getByText('2 слота')).toBeInTheDocument();
    for (const h of ['12:00', '13:00', '14:00']) await user.click(screen.getByRole('button', { name: new RegExp(h) }));
    expect(within(bar).getByText('5 слотов')).toBeInTheDocument();
  });

  it('retry refetches and shows the grid', async () => {
    vi.setSystemTime(new Date('2026-10-24T06:00:00Z'));
    mockApi([
      { path: '/venues/arena-one', body: { venue } },
      {
        path: '/venues/arena-one/turfs/t1/slots',
        body: (_c: unknown, n: number) =>
          n === 0 ? { status: 500, body: { error: { code: 'internal', message: 'x' } } } : { day: day(slots) },
      },
    ]);
    const { user } = renderApp('/venues/arena-one?date=2026-10-25');
    await user.click(await screen.findByRole('button', { name: en.search.retry }));
    expect(await screen.findByRole('button', { name: /10:00/ })).toBeInTheDocument();
    expect(screen.queryByText(en.errors.generic)).not.toBeInTheDocument();
  });

  it('changing turf clears selection', async () => {
    vi.setSystemTime(new Date('2026-10-24T06:00:00Z'));
    const two = { ...venue, turfs: [...venue.turfs, { id: 't2', name: 'Court B', sports: ['futsal'], indoor: false, slotLengthMin: 60 }] };
    mockApi([
      { path: '/venues/arena-one', body: { venue: two } },
      { path: /\/venues\/arena-one\/turfs\/t\d\/slots/, body: { day: day(slots) } },
    ]);
    const { user } = renderApp('/venues/arena-one?date=2026-10-25');
    await user.click(await screen.findByRole('button', { name: /10:00/ }));
    expect(screen.getByRole('link', { name: en.slots.continue })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Court B/ }));
    await waitFor(() => expect(screen.queryByRole('link', { name: en.slots.continue })).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /10:00/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
