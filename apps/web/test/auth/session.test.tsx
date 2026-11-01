import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { RequireAuth } from '../../src/auth/RequireAuth';
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
  platformAdmin: false,
};
const authRes = { user, accessToken: 'fresh-token' };

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

  it('mid-session refresh 503 keeps the session and fails the original request', async () => {
    mockApi([
      { method: 'POST', path: '/auth/refresh', status: 503, body: { error: { code: 'unavailable', message: 'x' } } },
      { path: '/me/bookings', status: 401, body: { error: { code: 'invalid_token', message: 'x' } } },
    ]);
    setAccessToken('stale');
    render(
      <AuthProvider initialUser={user}>
        <Probe />
      </AuthProvider>,
    );
    await expect(apiGet('/me/bookings')).rejects.toMatchObject({ status: 401 });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByTestId('status')).toHaveTextContent('signedIn');
  });

  it('mid-session refresh 429 keeps the session', async () => {
    mockApi([
      { method: 'POST', path: '/auth/refresh', status: 429, body: { error: { code: 'rate_limited', message: 'x' } } },
      { path: '/me/bookings', status: 401, body: { error: { code: 'invalid_token', message: 'x' } } },
    ]);
    setAccessToken('stale');
    render(
      <AuthProvider initialUser={user}>
        <Probe />
      </AuthProvider>,
    );
    await expect(apiGet('/me/bookings')).rejects.toMatchObject({ status: 401 });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByTestId('status')).toHaveTextContent('signedIn');
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

  it('falls back to a direct refresh when navigator.locks.request rejects', async () => {
    vi.stubGlobal('navigator', { ...navigator, locks: { request: () => Promise.reject(new Error('x')) } });
    mockApi([{ method: 'POST', path: '/auth/refresh', body: authRes }]);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedIn'));
  });

  it('runs the refresh inside the auth-refresh lock', async () => {
    const names: string[] = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: { request: (name: string, cb: () => unknown) => (names.push(name), Promise.resolve(cb())) },
    });
    const { calls } = mockApi([{ method: 'POST', path: '/auth/refresh', body: authRes }]);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedIn'));
    expect(names).toEqual(['auth-refresh']);
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
  });

  it('discards a refresh that resolves after signOut', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/auth/refresh')) {
          await gate;
          return new Response(JSON.stringify(authRes), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(null, { status: 204 });
      }),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'out' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('status')).toHaveTextContent('signedOut');
    expect(screen.getByTestId('name')).toHaveTextContent('');
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

describe('boot with a transient refresh failure', () => {
  function Guarded() {
    return (
      <MemoryRouter initialEntries={['/me/bookings']}>
        <AuthProvider>
          <Probe />
          <Routes>
            <Route path="/me/bookings" element={<RequireAuth><p>secret</p></RequireAuth>} />
            <Route path="/login" element={<p>login page</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
  }

  it('503 at boot -> offline with Retry, not redirected; Retry success signs in', async () => {
    let fail = true;
    mockApi([
      {
        method: 'POST',
        path: '/auth/refresh',
        body: () => (fail ? { status: 503, body: { error: { code: 'unavailable', message: 'x' } } } : authRes),
      },
    ]);
    render(<Guarded />);
    const retry = await screen.findByRole('button', { name: en.auth.retry });
    expect(screen.getByText(en.auth.offline)).toBeInTheDocument();
    expect(screen.queryByText('login page')).not.toBeInTheDocument();
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByText('secret')).toBeInTheDocument();
    expect(screen.getByTestId('status')).toHaveTextContent('signedIn');
  });

  it('network error at boot -> offline; retries on the online event', async () => {
    let fail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (fail) throw new TypeError('fail');
        return new Response(JSON.stringify(authRes), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    render(<Guarded />);
    await screen.findByRole('button', { name: en.auth.retry });
    expect(screen.getByTestId('status')).toHaveTextContent('offline');
    fail = false;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByText('secret')).toBeInTheDocument();
  });

  it('401 at boot still redirects to login', async () => {
    mockApi([{ method: 'POST', path: '/auth/refresh', status: 401, body: { error: { code: 'invalid_refresh_token', message: 'x' } } }]);
    render(<Guarded />);
    expect(await screen.findByText('login page')).toBeInTheDocument();
  });
});
