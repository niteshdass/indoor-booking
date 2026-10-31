import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { resetAuthProviders } from '../../src/auth/providers';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import type { PublicUser } from '../../src/lib/types';

const user: PublicUser = {
  id: 'u1',
  name: 'Player One',
  email: 'player1@seed.local',
  emailVerified: true,
  phone: null,
  hasPassword: true,
  hasGoogle: false,
  platformAdmin: false,
};

beforeEach(async () => {
  resetAuthProviders();
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

describe('demo sign-in', () => {
  it('shows a button per role on a demo deploy and signs in with one tap', async () => {
    const api = mockApi([
      { method: 'GET', path: '/auth/providers', body: { googleClientId: null, demo: true } },
      { method: 'POST', path: '/auth/demo/player', body: { user, accessToken: 'tok', refreshToken: 'r' } },
    ]);
    const h = renderApp('/login?next=%2Fme%2Fbookings');
    expect(await screen.findByRole('heading', { name: en.auth.demo.title })).toBeInTheDocument();
    for (const label of Object.values(en.auth.demo.roles)) expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    await h.user.click(screen.getByRole('button', { name: en.auth.demo.roles.player }));
    expect(await screen.findByRole('heading', { name: en.myBookings.title })).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/auth/demo/player')).toBe(true);
  });

  it('shows the reason when the demo data is missing', async () => {
    mockApi([
      { method: 'GET', path: '/auth/providers', body: { googleClientId: null, demo: true } },
      { method: 'POST', path: '/auth/demo/admin', status: 503, body: { error: { code: 'demo_not_seeded', message: 'x' } } },
    ]);
    const h = renderApp('/login');
    await h.user.click(await screen.findByRole('button', { name: en.auth.demo.roles.admin }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.demo_not_seeded);
  });

  it('is absent on a normal deploy', async () => {
    const api = mockApi([{ method: 'GET', path: '/auth/providers', body: { googleClientId: null, demo: false } }]);
    renderApp('/login');
    await waitFor(() => expect(api.calls.some((c) => c.path === '/auth/providers')).toBe(true));
    expect(screen.queryByRole('heading', { name: en.auth.demo.title })).not.toBeInTheDocument();
  });
});
