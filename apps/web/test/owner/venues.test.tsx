import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { draftFromVenue, validateVenue, venueBody, type VenueDraft } from '../../src/owner/venues/venueForm';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, ownerRoutes, staffUser, turf, venue } from './fixtures';

// Leaflet needs a real layout engine; the fake records the handlers the picker registers.
const leaflet = vi.hoisted(() => ({
  click: null as null | ((e: { latlng: { lat: number; lng: number } }) => void),
  drag: null as null | (() => void),
  markers: [] as { pos: [number, number]; setLatLng: (p: [number, number]) => void }[],
  dragTo: { lat: 0, lng: 0 },
}));
vi.mock('leaflet', () => {
  const map = {
    setView: vi.fn(() => map),
    on: vi.fn((ev: string, fn: typeof leaflet.click) => {
      if (ev === 'click') leaflet.click = fn;
      return map;
    }),
    remove: vi.fn(),
    getZoom: () => 13,
    getBounds: () => ({ contains: () => true }),
    getSize: () => ({ x: 100, y: 100 }),
    invalidateSize: vi.fn(),
  };
  const L = {
    map: vi.fn(() => map),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    divIcon: vi.fn((o: unknown) => o),
    marker: vi.fn((pos: [number, number]) => {
      const m = {
        pos,
        on: vi.fn((ev: string, fn: () => void) => {
          if (ev === 'dragend') leaflet.drag = fn;
          return m;
        }),
        addTo: vi.fn(() => m),
        setLatLng: vi.fn((p: [number, number]) => {
          m.pos = p;
          return m;
        }),
        getLatLng: () => leaflet.dragTo,
        remove: vi.fn(),
      };
      leaflet.markers.push(m);
      return m;
    }),
  };
  return { default: L };
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  leaflet.markers.length = 0;
  leaflet.click = null;
  leaflet.drag = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const draft = (over: Partial<VenueDraft> = {}): VenueDraft => ({ ...draftFromVenue(venue()), ...over });
const MANAGE = ['booking.view', 'venue.manage', 'turf.manage'] as const;

describe('validateVenue', () => {
  it('validateVenue flags bad country, timezone, coordinates, slug and photo urls', () => {
    expect(validateVenue(draft(), false)).toEqual({});
    const bad = validateVenue(
      draft({
        name: ' ',
        address: '',
        city: 'x'.repeat(101),
        country: 'bd',
        timezone: 'Mars/Base',
        lat: '91',
        lng: '-181',
        slug: 'Bad Slug',
        photos: [{ url: 'http://x.test/a.jpg', alt: '' }],
      }),
      true,
    );
    expect(Object.keys(bad).sort()).toEqual(['address', 'city', 'country', 'lat', 'lng', 'name', 'photos', 'slug', 'timezone']);
    expect(validateVenue(draft({ lat: '', lng: 'abc' }), false)).toMatchObject({ lat: expect.any(String), lng: expect.any(String) });
    expect(validateVenue(draft({ slug: '' }), true).slug).toBeUndefined();
    expect(validateVenue(draft({ slug: 'ab' }), true).slug).toBeDefined();
    const many = Array.from({ length: 21 }, () => ({ url: 'https://x.test/a.jpg', alt: '' }));
    expect(validateVenue(draft({ photos: many }), false).photos).toBeDefined();
  });
});

describe('venueBody', () => {
  it('venueBody on edit sends only changed keys and never currency', () => {
    const v = venue();
    expect(venueBody(draftFromVenue(v), v)).toEqual({});
    expect(venueBody({ ...draftFromVenue(v), name: 'New', currency: 'USD', lat: '23.5' }, v)).toEqual({
      name: 'New',
      location: { lat: 23.5, lng: 90.4 },
    });
    expect(venueBody({ ...draftFromVenue(v), amenities: ['wifi'], photos: [{ url: 'https://x.test/a.jpg', alt: '' }] }, v)).toEqual({
      amenities: ['wifi'],
      photos: [{ url: 'https://x.test/a.jpg' }],
    });
  });
  it('create sends every key, slug and currency only when set', () => {
    const body = venueBody(draft({ slug: '', currency: '' }), null) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['address', 'amenities', 'city', 'country', 'location', 'name', 'photos', 'timezone']);
    expect(venueBody(draft({ slug: 'arena', currency: 'usd' }), null)).toMatchObject({ slug: 'arena', currency: 'USD' });
  });
});

const TURFS = '/owners/o1/venues/v1/turfs';

describe('venues list', () => {
  it('lists venues with state and turf count', async () => {
    mockApi([
      ...ownerRoutes({ permissions: [...MANAGE], venues: [venue(), venue({ id: 'v2', name: 'Arena Two', published: false })] }),
      { path: TURFS, body: { turfs: [turf(), turf({ id: 't2', name: 'B' })] } },
      { path: '/owners/o1/venues/v2/turfs', body: { turfs: [] } },
    ]);
    renderApp(`/owner/${OWNER_ID}/venues`, { user: staffUser });
    const row = (await screen.findByText('Arena One')).closest('tr')!;
    expect(within(row).getByText(en.owner.venues.published)).toBeTruthy();
    await waitFor(() => expect(within(row).getByText('2')).toBeTruthy());
    expect(within(screen.getByText('Arena Two').closest('tr')!).getByText(en.owner.venues.draft)).toBeTruthy();
    expect(screen.getByRole('link', { name: en.owner.venues.new })).toBeTruthy();
  });

  it('new venue hidden for venue-scoped members', async () => {
    mockApi([...ownerRoutes({ permissions: [...MANAGE], venueIds: ['v1'] }), { path: TURFS, body: { turfs: [] } }]);
    renderApp(`/owner/${OWNER_ID}/venues`, { user: staffUser });
    expect(await screen.findByText('Arena One')).toBeTruthy();
    expect(screen.queryByRole('link', { name: en.owner.venues.new })).toBeNull();
  });
});

describe('venue editor', () => {
  it('create venue posts the form and opens the new venue', async () => {
    const created = venue({ id: 'v2', name: 'Court Hub' });
    const api = mockApi([
      // First match wins and the owner fixtures' GET route has no method, so the POST goes first.
      { method: 'POST', path: '/owners/o1/venues', status: 201, body: { venue: created } },
      ...ownerRoutes({ permissions: [...MANAGE] }),
      { path: '/owners/o1/venues/v2', body: { venue: created } },
      { path: '/owners/o1/venues/v2/turfs', body: { turfs: [] } },
    ]);
    const { user, location } = renderApp(`/owner/${OWNER_ID}/venues/new`, { user: staffUser });
    await user.type(await screen.findByLabelText(en.owner.venues.name), 'Court Hub');
    await user.type(screen.getByLabelText(en.owner.venues.address), '2 Side Street');
    await user.type(screen.getByLabelText(en.owner.venues.city), 'Dhaka');
    await user.clear(screen.getByLabelText(en.owner.venues.country));
    await user.type(screen.getByLabelText(en.owner.venues.country), 'bd');
    await user.type(screen.getByLabelText(en.owner.venues.timezone), 'Asia/Dhaka');
    await user.type(screen.getByLabelText(en.owner.venues.latitude), '23.8');
    await user.type(screen.getByLabelText(en.owner.venues.longitude), '90.4');
    await user.click(screen.getByRole('checkbox', { name: en.amenities.wifi }));
    await user.click(screen.getByRole('button', { name: en.owner.venues.create }));
    await waitFor(() => expect(location().pathname).toBe(`/owner/${OWNER_ID}/venues/v2`));
    const post = api.calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({
      name: 'Court Hub',
      address: '2 Side Street',
      city: 'Dhaka',
      country: 'BD',
      timezone: 'Asia/Dhaka',
      currency: 'BDT',
      location: { lat: 23.8, lng: 90.4 },
      amenities: ['wifi'],
      photos: [],
    });
  });

  it('publish without an active turf shows venue_not_ready', async () => {
    const api = mockApi([
      ...ownerRoutes({ permissions: [...MANAGE], venues: [venue({ published: false })] }),
      { path: TURFS, body: { turfs: [] } },
      { method: 'PATCH', path: '/owners/o1/venues/v1', status: 409, body: { error: { code: 'venue_not_ready', message: 'x' } } },
    ]);
    const { user } = renderApp(`/owner/${OWNER_ID}/venues/v1`, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.owner.venues.publish }));
    expect((await screen.findByRole('alert')).textContent).toContain(en.errors.venue_not_ready);
    expect(api.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ published: true });
  });

  it('delete reports venue_has_turfs', async () => {
    mockApi([
      ...ownerRoutes({ permissions: [...MANAGE] }),
      { path: TURFS, body: { turfs: [turf()] } },
      { method: 'DELETE', path: '/owners/o1/venues/v1', status: 409, body: { error: { code: 'venue_has_turfs', message: 'x' } } },
    ]);
    const { user } = renderApp(`/owner/${OWNER_ID}/venues/v1`, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: en.owner.venues.delete }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await user.click(within(dialog).getByRole('button', { name: en.owner.venues.deleteConfirm, hidden: true }));
    expect((await within(dialog).findByText(en.errors.venue_has_turfs, undefined, { timeout: 2000 })).textContent).toBeTruthy();
  });

  it('is read-only without venue.manage', async () => {
    mockApi([...ownerRoutes({ permissions: ['booking.view'] }), { path: TURFS, body: { turfs: [] } }]);
    renderApp(`/owner/${OWNER_ID}/venues/v1`, { user: staffUser });
    const name = (await screen.findByLabelText(en.owner.venues.name)) as HTMLInputElement;
    expect(name.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: en.owner.venues.save })).toBeNull();
  });

  it('location picker fields update the draft', async () => {
    mockApi([...ownerRoutes({ permissions: [...MANAGE] }), { path: TURFS, body: { turfs: [] } }]);
    const { user } = renderApp(`/owner/${OWNER_ID}/venues/v1`, { user: staffUser });
    const lat = (await screen.findByLabelText(en.owner.venues.latitude)) as HTMLInputElement;
    const lng = screen.getByLabelText(en.owner.venues.longitude) as HTMLInputElement;
    // Typing moves the marker.
    await user.clear(lat);
    await user.type(lat, '24.5');
    await waitFor(() => expect(leaflet.markers.at(-1)!.pos).toEqual([24.5, 90.4]));
    // Clicking the map fills both fields, rounded to 6 decimals.
    act(() => leaflet.click!({ latlng: { lat: 23.123456789, lng: 90.987654321 } }));
    await waitFor(() => expect(lat.value).toBe('23.123457'));
    expect(lng.value).toBe('90.987654');
    // Dragging the marker does the same.
    leaflet.dragTo = { lat: 10.5, lng: 11.5 };
    act(() => leaflet.drag!());
    await waitFor(() => expect(lat.value).toBe('10.5'));
    expect(lng.value).toBe('11.5');
  });
});

describe('turf list', () => {
  it('create turf posts name, sports, indoor and slotLengthMin', async () => {
    const created = turf({ id: 't9', name: 'Court 2' });
    const api = mockApi([
      ...ownerRoutes({ permissions: [...MANAGE] }),
      { method: 'POST', path: TURFS, status: 201, body: { turf: created } },
      { path: TURFS, body: { turfs: [turf()] } },
    ]);
    const { user, location } = renderApp(`/owner/${OWNER_ID}/venues/v1?tab=turfs`, { user: staffUser });
    expect(await screen.findByRole('link', { name: 'Pitch A' })).toBeTruthy();
    await user.type(screen.getByLabelText(en.owner.venues.turfName), 'Court 2');
    await user.click(screen.getByRole('checkbox', { name: en.sports.padel }));
    await user.click(screen.getByRole('checkbox', { name: en.owner.venues.indoorLabel }));
    await user.selectOptions(screen.getByLabelText(en.owner.venues.slotLength), '90');
    await user.click(screen.getByRole('button', { name: en.owner.venues.createTurf }));
    await waitFor(() => expect(location().pathname).toBe(`/owner/${OWNER_ID}/venues/v1/turfs/t9`));
    expect(api.calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Court 2', sports: ['padel'], indoor: true, slotLengthMin: 90 });
  });

  it('hides the create form without turf.manage', async () => {
    mockApi([...ownerRoutes({ permissions: ['booking.view'] }), { path: TURFS, body: { turfs: [turf()] } }]);
    renderApp(`/owner/${OWNER_ID}/venues/v1?tab=turfs`, { user: staffUser });
    expect(await screen.findByRole('link', { name: 'Pitch A' })).toBeTruthy();
    expect(screen.queryByLabelText(en.owner.venues.turfName)).toBeNull();
  });
});
