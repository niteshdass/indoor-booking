import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { resetSports } from '../../src/lib/sports';
import { mockApi, type Route } from '../helpers/api';
import { renderApp } from '../helpers/render';
import { OWNER_ID, ownerRoutes, staffUser, venue } from '../owner/fixtures';
import type { BusinessSetup } from '@booking/shared';
import type { Permission } from '../../src/owner/types';

// The real picker needs Leaflet; a button that drops the pin stands in for it.
vi.mock('../../src/owner/venues/LocationPicker', () => ({
  LocationPicker: ({ onChange }: { onChange(lat: number, lng: number): void }) => (
    <button type="button" onClick={() => onChange(23.75, 90.37)}>
      drop pin
    </button>
  ),
}));

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  resetSports();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const label = (text: string) => new RegExp(text.replace(/\{\{\w+\}\}/g, '.*').replace(/[()]/g, '\\$&'));
const sports: Route = { path: '/sports', body: { sports: ['football', 'cricket'] } };

async function answerAll(h: ReturnType<typeof renderApp>) {
  const next = () => h.user.click(screen.getByRole('button', { name: en.onboarding.next }));
  await h.user.type(await screen.findByRole('textbox', { name: label(en.onboarding.name.label) }), 'Dhanmondi Turf');
  await next();

  expect(await screen.findByRole('heading', { name: en.onboarding.place.question })).toHaveFocus();
  await next();
  expect(screen.getByText(en.onboarding.err.city)).toBeInTheDocument();
  expect(screen.getByText(en.onboarding.err.pin)).toBeInTheDocument();
  await h.user.type(screen.getByRole('textbox', { name: label(en.onboarding.place.city) }), 'Dhaka');
  await h.user.type(screen.getByRole('textbox', { name: label(en.onboarding.place.address) }), 'Road 27');
  await h.user.click(await screen.findByRole('button', { name: 'drop pin' }));
  await next();

  await screen.findByRole('heading', { name: en.onboarding.turfs.question });
  await h.user.click(screen.getByRole('button', { name: en.onboarding.turfs.more }));
  await h.user.click(screen.getByRole('radio', { name: new RegExp(en.onboarding.turfs.indoor) }));
  await next();

  await screen.findByRole('heading', { name: en.onboarding.hours.question });
  await h.user.click(screen.getByRole('radio', { name: en.onboarding.length.m60 }));
  await next();

  await screen.findByRole('heading', { name: en.onboarding.price.question });
  await h.user.type(screen.getByRole('textbox', { name: label(en.onboarding.price.label) }), '১২০০');
  await next();

  await screen.findByRole('heading', { name: en.onboarding.payment.question });
  await h.user.type(screen.getByRole('textbox', { name: /bKash/ }), '01712345678');
  await next();

  await screen.findByRole('heading', { name: en.onboarding.review.question });
}

describe('list your venue', () => {
  it('asks one thing at a time and creates the business with its first venue', async () => {
    const api = mockApi([
      sports,
      { method: 'POST', path: '/onboarding', status: 201, body: { owner: { id: 'o9', name: 'Dhanmondi Turf', status: 'pending_approval' }, venue: { id: 'v9', slug: 'dhanmondi-turf', published: false } } },
    ]);
    const h = renderApp('/list-your-venue', { user: staffUser });
    await answerAll(h);
    expect(screen.getByText('Turf 1, Turf 2')).toBeInTheDocument();
    await h.user.click(screen.getByRole('button', { name: en.onboarding.finish }));

    expect(await screen.findByRole('heading', { name: en.onboarding.done.pendingTitle })).toHaveFocus();
    expect(screen.getByRole('link', { name: en.onboarding.done.status })).toHaveAttribute('href', '/owner');
    const body = api.calls.find((c) => c.method === 'POST')!.body as BusinessSetup;
    expect(body.business).toEqual({ name: 'Dhanmondi Turf', country: 'BD', currency: 'BDT', locale: 'en' });
    expect(body.venue).toMatchObject({ name: 'Dhanmondi Turf', city: 'Dhaka', address: 'Road 27', location: { lat: 23.75, lng: 90.37 } });
    expect(body.turfs).toHaveLength(2);
    expect(body.turfs[0]).toMatchObject({ name: 'Turf 1', sports: ['football'], indoor: true, slotLengthMin: 60, pricing: { base: 120_000, rules: [] } });
    expect(body.settings.paymentMethods.manualWallets).toEqual([{ provider: 'bkash', number: '01712345678', accountType: 'personal' }]);
    expect(localStorage.getItem('setup-draft')).toBeNull();
  });

  it('keeps the answers when the page is opened again', async () => {
    mockApi([sports]);
    const first = renderApp('/list-your-venue', { user: staffUser });
    await first.user.type(await screen.findByRole('textbox', { name: label(en.onboarding.name.label) }), 'Saved Turf');
    await first.user.click(screen.getByRole('button', { name: en.onboarding.next }));
    await screen.findByRole('heading', { name: en.onboarding.place.question });
    first.unmount();

    const again = renderApp('/list-your-venue', { user: staffUser });
    expect(await screen.findByRole('heading', { name: en.onboarding.place.question })).toBeInTheDocument();
    await again.user.click(screen.getByRole('button', { name: en.onboarding.back }));
    expect(screen.getByRole('textbox', { name: label(en.onboarding.name.label) })).toHaveValue('Saved Turf');
  });

  it('says so when an application is already waiting', async () => {
    mockApi([sports, { method: 'POST', path: '/onboarding', status: 409, body: { error: { code: 'application_pending', message: 'x' } } }]);
    const h = renderApp('/list-your-venue', { user: staffUser });
    await answerAll(h);
    await h.user.click(screen.getByRole('button', { name: en.onboarding.finish }));
    expect(await screen.findByText(en.errors.application_pending)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.apply.seeStatus })).toHaveAttribute('href', '/owner');
  });
});

describe('add a venue', () => {
  const all: Permission[] = ['booking.view', 'booking.create', 'venue.manage', 'turf.manage', 'pricing.edit'];

  it('adds a venue to the business and offers the first booking', async () => {
    const api = mockApi([
      sports,
      ...ownerRoutes({ permissions: all }),
      { method: 'POST', path: `/owners/${OWNER_ID}/onboarding`, status: 201, body: { owner: { id: OWNER_ID, name: 'Arena', status: 'active' }, venue: { id: 'v9', slug: 'dhanmondi-turf', published: true } } },
    ]);
    const h = renderApp(`/owner/${OWNER_ID}/venues/setup`, { user: staffUser });
    await answerAll(h);
    await h.user.click(screen.getByRole('button', { name: en.onboarding.finish }));

    expect(await screen.findByRole('heading', { name: en.onboarding.done.title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.onboarding.done.book })).toHaveAttribute('href', `/owner/${OWNER_ID}/walk-in?venue=v9`);
    expect(screen.getByText(`${window.location.origin}/venues/dhanmondi-turf`)).toBeInTheDocument();
    const body = api.calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('business');
    expect(body.publish).toBe(true);
    // The venue list is fetched again before the done screen, so its links open the new venue, not the first one.
    const after = api.calls.slice(api.calls.findIndex((c) => c.method === 'POST'));
    expect(after.some((c) => c.path === `/owners/${OWNER_ID}/venues`)).toBe(true);
  });

  it('is only for members who run every venue', async () => {
    mockApi([sports, ...ownerRoutes({ permissions: all, venueIds: ['v1'] })]);
    renderApp(`/owner/${OWNER_ID}/venues/setup`, { user: staffUser });
    expect(await screen.findByText(en.onboarding.notAllowed)).toBeInTheDocument();
  });
});

describe('first week on Today', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T03:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  const fresh = venue({ createdAt: '2026-10-20T00:00:00.000Z', published: true });
  const routes = (permissions: Permission[]) => [...ownerRoutes({ permissions, venues: [fresh] }), { path: `/owners/${OWNER_ID}/bookings`, body: { bookings: [] } }];

  it('lists the steps off paper, ticks itself for publishing and remembers hand ticks', async () => {
    mockApi(routes(['booking.view', 'booking.create', 'venue.manage']));
    const h = renderApp(`/owner/${OWNER_ID}/today`, { user: staffUser });
    const card = await screen.findByRole('region', { name: new RegExp(en.owner.firstWeek.title) });
    expect(card.textContent).toContain('1 of 4');
    expect(screen.getByRole('link', { name: en.owner.firstWeek.paperGo })).toHaveAttribute('href', `/owner/${OWNER_ID}/walk-in?venue=v1`);
    expect(screen.queryByText(en.owner.firstWeek.helper)).not.toBeInTheDocument();
    await h.user.click(screen.getByRole('checkbox', { name: new RegExp(en.owner.firstWeek.paper) }));
    expect(card.textContent).toContain('2 of 4');
    expect(JSON.parse(localStorage.getItem('first-week:v1')!)).toEqual({ done: ['paper'], hidden: false });
    await h.user.click(screen.getByRole('button', { name: en.owner.firstWeek.hide }));
    expect(screen.queryByRole('region', { name: new RegExp(en.owner.firstWeek.title) })).not.toBeInTheDocument();
  });

  it('is not shown for an older venue', async () => {
    mockApi([...ownerRoutes({ permissions: ['booking.view', 'venue.manage'] }), { path: `/owners/${OWNER_ID}/bookings`, body: { bookings: [] } }]);
    renderApp(`/owner/${OWNER_ID}/today`, { user: staffUser });
    await screen.findByText(en.owner.today.dueAtDesk);
    expect(screen.queryByText(en.owner.firstWeek.title)).not.toBeInTheDocument();
  });
});
