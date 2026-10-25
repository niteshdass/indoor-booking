import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { summarize } from '../../src/owner/today/summarize';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, ownerBooking, ownerRoutes, staffUser } from './fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-26T03:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const slot = (startAt: string, endAt: string) => ({ startAt, endAt, price: 1000 });

describe('summarize', () => {
  it('summarize counts live bookings, nets refunds into collected and counts pending', () => {
    const s = summarize([
      ownerBooking({ id: 'a', status: 'confirmed', amountPaid: 3000 }),
      ownerBooking({ id: 'b', status: 'cancelled', amountPaid: 2000, amountRefunded: 2000 }),
      ownerBooking({ id: 'c', status: 'pending' }),
      ownerBooking({ id: 'd', status: 'expired' }),
    ]);
    expect(s.count).toBe(2);
    expect(s.collected).toBe(3000);
    expect(s.pending).toBe(1);
  });

  it('summarize upcoming excludes finished and terminal bookings', () => {
    const later = [slot('2026-10-26T08:00:00.000Z', '2026-10-26T09:00:00.000Z')];
    const soon = [slot('2026-10-26T04:00:00.000Z', '2026-10-26T05:00:00.000Z')];
    const past = [slot('2026-10-26T01:00:00.000Z', '2026-10-26T02:00:00.000Z')];
    const s = summarize([
      ownerBooking({ id: 'later', status: 'confirmed', slots: later }),
      ownerBooking({ id: 'soon', status: 'pending', slots: soon }),
      ownerBooking({ id: 'past', status: 'confirmed', slots: past }),
      ownerBooking({ id: 'done', status: 'completed', slots: soon }),
      ownerBooking({ id: 'gone', status: 'cancelled', slots: soon }),
    ]);
    expect(s.upcoming.map((b) => b.id)).toEqual(['soon', 'later']);
  });
});

describe('Today page', () => {
  it('Today shows stat cards in venue currency for the selected venue', async () => {
    const api = mockApi([
      ...ownerRoutes(),
      {
        path: '/owners/o1/bookings',
        body: {
          bookings: [
            ownerBooking({ id: 'a', status: 'confirmed', amountPaid: 3000, paymentStatus: 'paid' }),
            ownerBooking({ id: 'b', status: 'pending', customer: { name: 'Bob Pending', phone: null, email: null } }),
          ],
        },
      },
    ]);
    renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    const collected = (await screen.findByText(en.owner.today.collected)).closest('div')!;
    expect(collected.textContent).toMatch(/BDT\s30\.00/);
    expect(api.calls.find((c) => c.path === '/owners/o1/bookings')!.query.get('venueId')).toBe('v1');
    const pending = screen.getByText(en.owner.today.pending).closest('div')!;
    expect(within(pending).getByText('1')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Bob Pending/ });
    expect(link.getAttribute('href')).toBe(`/owner/${OWNER_ID}/bookings/b`);
  });

  it('Today with no venues prompts to create one', async () => {
    mockApi(ownerRoutes({ venues: [], permissions: ['booking.view', 'venue.manage'] }));
    renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    expect(await screen.findByText(en.owner.today.noVenues)).toBeTruthy();
    const link = screen.getByRole('link', { name: en.owner.today.createVenue });
    expect(link.getAttribute('href')).toBe(`/owner/${OWNER_ID}/venues/new`);
  });
});
