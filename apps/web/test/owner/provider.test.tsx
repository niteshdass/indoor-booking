import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { OwnerProvider } from '../../src/owner/OwnerProvider';
import { RequirePermission } from '../../src/owner/RequirePermission';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, ownerMembership, ownerRoutes, staffUser } from './fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const two = [
  ownerMembership({ ownerId: 'o1', ownerName: 'Acme' }),
  ownerMembership({ ownerId: 'o2', ownerName: 'Beta' }),
];

describe('owner picker', () => {
  it('/owner redirects to the first membership', async () => {
    mockApi([
      { path: '/me/memberships', body: { memberships: two } },
      ...ownerRoutes(),
    ]);
    const h = renderApp('/owner', { user: staffUser });
    await waitFor(() => expect(h.location().pathname).toBe('/owner/o1'));
    expect(h.location().navType).toBe('REPLACE');
  });

  it('/owner prefers the remembered owner when still a member', async () => {
    localStorage.setItem('owner.last', 'o2');
    mockApi([
      { path: '/me/memberships', body: { memberships: two } },
      { path: /^\/owners\//, status: 404, body: { error: { code: 'not_found', message: 'x' } } },
    ]);
    const h = renderApp('/owner', { user: staffUser });
    await waitFor(() => expect(h.location().pathname).toBe('/owner/o2'));
  });

  it('/owner ignores a remembered owner that is no longer a membership', async () => {
    localStorage.setItem('owner.last', 'gone');
    mockApi([
      { path: '/me/memberships', body: { memberships: two } },
      { path: /^\/owners\//, status: 404, body: { error: { code: 'not_found', message: 'x' } } },
    ]);
    const h = renderApp('/owner', { user: staffUser });
    await waitFor(() => expect(h.location().pathname).toBe('/owner/o1'));
  });

  it('/owner with no memberships shows owner.noTeams', async () => {
    mockApi([{ path: '/me/memberships', body: { memberships: [] } }]);
    renderApp('/owner', { user: staffUser });
    expect(await screen.findByText(en.owner.noTeams)).toBeInTheDocument();
  });
});

describe('OwnerProvider', () => {
  it('loads the three resources, remembers the owner and renders the route', async () => {
    const api = mockApi(ownerRoutes());
    const h = renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    expect(await screen.findByText(en.owner.comingSoon)).toBeInTheDocument();
    expect(api.calls.map((c) => c.path).sort()).toEqual(['/me/memberships', `/owners/${OWNER_ID}`, `/owners/${OWNER_ID}/venues`]);
    expect(localStorage.getItem('owner.last')).toBe(OWNER_ID);
    expect(h.location().pathname).toBe(`/owner/${OWNER_ID}`);
  });

  it('unknown owner id renders owner.notFound', async () => {
    mockApi([
      { path: '/owners/zz', status: 404, body: { error: { code: 'not_found', message: 'x' } } },
      { path: '/me/memberships', body: { memberships: [] } },
      { path: '/owners/zz/venues', status: 404, body: { error: { code: 'not_found', message: 'x' } } },
    ]);
    renderApp('/owner/zz', { user: staffUser });
    expect(await screen.findByText(en.owner.notFound)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.owner.pickTeam })).toHaveAttribute('href', '/owner');
  });

  it('inactive owner renders owner.inactive', async () => {
    const err = { error: { code: 'owner_inactive', message: 'x' } };
    mockApi([
      { path: `/owners/${OWNER_ID}`, status: 403, body: err },
      { path: '/me/memberships', body: { memberships: [ownerMembership()] } },
      { path: `/owners/${OWNER_ID}/venues`, status: 403, body: err },
    ]);
    renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    expect(await screen.findByText(en.owner.inactive)).toBeInTheDocument();
  });
});

describe('RequirePermission', () => {
  function Gate({ perm, any }: { perm: Parameters<typeof RequirePermission>[0]['perm']; any?: boolean }) {
    return (
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/owner/${OWNER_ID}`]}>
          <Routes>
            <Route
              path="/owner/:ownerId"
              element={
                <OwnerProvider>
                  <RequirePermission perm={perm} any={any}>
                    <p>secret</p>
                  </RequirePermission>
                </OwnerProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    );
  }

  it('blocks a member without the permission', async () => {
    mockApi(ownerRoutes({ permissions: ['booking.view'] }));
    render(<Gate perm="refund.issue" />);
    expect(await screen.findByText(en.owner.noAccess)).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('allows a member who holds the permission', async () => {
    mockApi(ownerRoutes({ permissions: ['booking.view'] }));
    render(<Gate perm="booking.view" />);
    expect(await screen.findByText('secret')).toBeInTheDocument();
  });

  it('needs all listed permissions unless any is set', async () => {
    mockApi(ownerRoutes({ permissions: ['booking.view'] }));
    const first = render(<Gate perm={['booking.view', 'refund.issue']} />);
    expect(await screen.findByText(en.owner.noAccess)).toBeInTheDocument();
    first.unmount();
    render(<Gate perm={['booking.view', 'refund.issue']} any />);
    expect(await screen.findByText('secret')).toBeInTheDocument();
  });
});

describe('profile portal link', () => {
  it('profile links to the portal only for members', async () => {
    mockApi([{ path: '/me/memberships', body: { memberships: [ownerMembership()] } }]);
    const first = renderApp('/profile', { user: staffUser });
    expect(await screen.findByRole('link', { name: en.owner.portalLink })).toHaveAttribute('href', '/owner');
    first.unmount();

    vi.unstubAllGlobals();
    const api = mockApi([{ path: '/me/memberships', body: { memberships: [] } }]);
    renderApp('/profile', { user: staffUser });
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(0));
    expect(screen.queryByRole('link', { name: en.owner.portalLink })).not.toBeInTheDocument();
  });
});

describe('auth gate', () => {
  it('signed-out /owner/o1 redirects to /login?next=%2Fowner%2Fo1', async () => {
    mockApi([{ method: 'POST', path: '/auth/refresh', status: 401, body: { error: { code: 'unauthorized', message: 'x' } } }]);
    const h = renderApp(`/owner/${OWNER_ID}`);
    await waitFor(() => expect(h.location().pathname).toBe('/login'));
    expect(h.location().search).toBe('?next=%2Fowner%2Fo1');
  });
});
