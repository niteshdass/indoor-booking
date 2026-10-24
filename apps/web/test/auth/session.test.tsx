import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import { AuthProvider, useAuth } from '../../src/auth/AuthProvider';
import { apiGet, setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import { mockApi, type Call } from '../helpers/api';
import type { PublicUser } from '../../src/lib/types';

const user: PublicUser = {
  id: 'u1',
  name: 'Ada Player',
  email: 'ada@example.com',
  emailVerified: true,
  phone: null,
  hasPassword: true,
  hasGoogle: false,
};
const authRes = { user, accessToken: 'fresh-token', refreshToken: 'r' };

function Probe() {
  const { status, user: u, signOut } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="name">{u?.name ?? ''}</span>
      <button onClick={() => void signOut()}>out</button>
    </div>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

describe('AuthProvider', () => {
  it('restores session from refresh cookie', async () => {
    const { calls } = mockApi([{ method: 'POST', path: '/auth/refresh', body: authRes }]);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Ada Player'));
    expect(screen.getByTestId('status')).toHaveTextContent('signedIn');
    expect(calls[0]?.credentials).toBe('include');
  });

  it('refresh 401 -> signed out', async () => {
    mockApi([{ method: 'POST', path: '/auth/refresh', status: 401, body: { error: { code: 'invalid_token', message: 'x' } } }]);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
  });

  it('concurrent 401s trigger one refresh', async () => {
    const { calls } = mockApi([
      { method: 'POST', path: '/auth/refresh', body: authRes },
      {
        path: '/me/bookings',
        body: (c: Call) =>
          c.headers.get('Authorization') === 'Bearer fresh-token'
            ? { items: [] }
            : { status: 401, body: { error: { code: 'invalid_token', message: 'x' } } },
      },
    ]);
    render(
      <AuthProvider initialUser={user}>
        <Probe />
      </AuthProvider>,
    );
    const [a, b] = await Promise.all([apiGet('/me/bookings'), apiGet('/me/bookings')]);
    expect(a).toEqual({ items: [] });
    expect(b).toEqual({ items: [] });
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
  });

  it('signOut posts logout and clears user even when logout fails', async () => {
    const { calls } = mockApi([{ method: 'POST', path: '/auth/logout', status: 500, body: { error: { code: 'x', message: 'x' } } }]);
    render(
      <AuthProvider initialUser={user}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId('status')).toHaveTextContent('signedIn');
    await userEvent.click(screen.getByRole('button', { name: 'out' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    expect(calls.some((c) => c.path === '/auth/logout' && c.credentials === 'include')).toBe(true);
    expect(screen.getByTestId('name')).toHaveTextContent('');
  });
});

describe('RequireAuth', () => {
  it('redirects to login with next', async () => {
    mockApi([]);
    const { location } = renderApp('/me/bookings');
    await waitFor(() => expect(location().pathname).toBe('/login'));
    expect(location().search).toBe('?next=%2Fme%2Fbookings');
    expect(screen.getByRole('heading', { name: en.auth.login.title })).toBeInTheDocument();
  });
});
