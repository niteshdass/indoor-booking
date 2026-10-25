import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { OwnerProvider } from '../../src/owner/OwnerProvider';
import { useVenueParam } from '../../src/owner/shell/useVenueParam';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, ownerMembership, ownerRoutes, staffUser, venue } from './fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const nav = () => screen.getByRole('navigation', { name: en.owner.nav.label });

describe('owner nav', () => {
  it('nav shows only items the membership can use', async () => {
    mockApi(ownerRoutes({ permissions: ['booking.view', 'booking.create'] }));
    renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    await screen.findByRole('navigation', { name: en.owner.nav.label });
    const labels = Array.from(nav().querySelectorAll('a')).map((a) => a.textContent);
    expect(labels).toEqual([
      en.owner.nav.today,
      en.owner.nav.schedule,
      en.owner.nav.bookings,
      en.owner.nav.walkIn,
      en.owner.nav.series,
      en.owner.nav.venues,
    ]);
  });

  it('active nav item has aria-current=page', async () => {
    mockApi(ownerRoutes({ permissions: ['booking.view'] }));
    renderApp(`/owner/${OWNER_ID}/bookings`, { user: staffUser });
    const active = await screen.findByRole('link', { name: en.owner.nav.bookings });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: en.owner.nav.today })).not.toHaveAttribute('aria-current');
  });
});

describe('owner switcher', () => {
  it('switcher lists memberships and navigates to the picked owner', async () => {
    mockApi([
      { path: '/me/memberships', body: { memberships: [ownerMembership(), ownerMembership({ ownerId: 'o2', ownerName: 'Beta Club', ownerStatus: 'suspended' })] } },
      ...ownerRoutes(),
      { path: '/owners/o2', status: 404, body: { error: { code: 'not_found', message: 'x' } } },
      { path: '/owners/o2/venues', status: 404, body: { error: { code: 'not_found', message: 'x' } } },
    ]);
    const h = renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    const button = await screen.findByRole('button', { name: /Acme Sports/ });
    expect(button).toHaveTextContent('Manager');
    await h.user.click(button);
    const options = within(screen.getByRole('listbox', { name: en.owner.switcher })).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[1]).toHaveTextContent(en.owner.status.suspended);
    await h.user.click(options[1]!);
    await waitFor(() => expect(h.location().pathname).toBe('/owner/o2'));
  });
});

describe('drawer', () => {
  it('drawer opens from the menu button and closes on Escape returning focus', async () => {
    mockApi(ownerRoutes());
    const h = renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    const menu = await screen.findByRole('button', { name: en.owner.menu });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    await h.user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    await h.user.keyboard('{Escape}');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveFocus();
  });

  it('closes when navigating', async () => {
    mockApi(ownerRoutes());
    const h = renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    const menu = await screen.findByRole('button', { name: en.owner.menu });
    await h.user.click(menu);
    await h.user.click(screen.getByRole('link', { name: en.owner.nav.bookings }));
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('useVenueParam', () => {
  function Probe() {
    const [v, setVenueId] = useVenueParam();
    const { search } = useLocation();
    return (
      <div>
        <p data-testid="v">{v?.id ?? 'none'}</p>
        <p data-testid="s">{search}</p>
        <button onClick={() => setVenueId('v2')}>pick</button>
      </div>
    );
  }

  it('useVenueParam falls back to the first venue and keeps other params when set', async () => {
    mockApi(ownerRoutes({ venues: [venue(), venue({ id: 'v2', name: 'Arena Two' })] }));
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/owner/${OWNER_ID}?date=2026-10-26`]}>
          <Routes>
            <Route path="/owner/:ownerId" element={<OwnerProvider><Probe /></OwnerProvider>} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(await screen.findByTestId('v')).toHaveTextContent('v1');
    await userEvent.click(screen.getByRole('button', { name: 'pick' }));
    expect(screen.getByTestId('v')).toHaveTextContent('v2');
    const params = new URLSearchParams(screen.getByTestId('s').textContent ?? '');
    expect(params.get('venue')).toBe('v2');
    expect(params.get('date')).toBe('2026-10-26');
  });
});
