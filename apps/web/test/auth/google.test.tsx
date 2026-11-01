import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import { mockApi, type Route } from '../helpers/api';
import { resetGoogleClientId } from '../../src/auth/GoogleButton';
import type { PublicUser } from '../../src/lib/types';

const user: PublicUser = {
  id: 'u1',
  name: 'Ada Player',
  email: 'ada@example.com',
  emailVerified: true,
  phone: null,
  hasPassword: false,
  hasGoogle: true,
  platformAdmin: false,
};

type Init = { client_id: string; callback(r: { credential: string }): void };
let init: Init | null = null;
let rendered: { el: HTMLElement; opts: Record<string, unknown> } | null = null;

function stubGoogle() {
  init = null;
  rendered = null;
  (window as unknown as { google: unknown }).google = {
    accounts: {
      id: {
        initialize: (o: Init) => {
          init = o;
        },
        renderButton: (el: HTMLElement, opts: Record<string, unknown>) => {
          rendered = { el, opts };
        },
      },
    },
  };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  resetGoogleClientId();
  stubGoogle();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { google?: unknown }).google;
  setAccessToken(null);
  setRefreshHandler(null);
});

const providers: Route = { method: 'GET', path: '/auth/providers', body: { googleClientId: 'cid.apps.googleusercontent.com' } };

describe('GoogleButton', () => {
  it('hidden without client id', async () => {
    const api = mockApi([{ method: 'GET', path: '/auth/providers', body: { googleClientId: null } }]);
    renderApp('/login');
    await waitFor(() => expect(api.calls.some((c) => c.path === '/auth/providers')).toBe(true));
    expect(screen.queryByText(en.auth.or)).not.toBeInTheDocument();
    expect(init).toBeNull();
  });

  it('initializes and renders the button with theme and locale', async () => {
    mockApi([providers]);
    renderApp('/login');
    await waitFor(() => expect(rendered).not.toBeNull());
    expect(init?.client_id).toBe('cid.apps.googleusercontent.com');
    expect(rendered?.opts).toMatchObject({ theme: 'filled_blue', size: 'large', text: 'signin_with', locale: 'en' });
    expect(screen.getByText(en.auth.or)).toBeInTheDocument();
  });

  it('says "Sign up with Google" on the create-account page', async () => {
    mockApi([providers]);
    renderApp('/register');
    await waitFor(() => expect(rendered).not.toBeNull());
    expect(rendered?.opts).toMatchObject({ text: 'signup_with' });
  });

  it('credential posts idToken and signs in', async () => {
    const api = mockApi([providers, { method: 'POST', path: '/auth/google', body: { user, accessToken: 'tok' } }]);
    const h = renderApp('/register?next=%2Fme%2Fbookings');
    await waitFor(() => expect(init).not.toBeNull());
    await act(async () => init?.callback({ credential: 'tok' }));
    await waitFor(() => expect(h.location().pathname).toBe('/me/bookings'));
    expect(api.calls.find((c) => c.path === '/auth/google')?.body).toEqual({ idToken: 'tok' });
  });

  it('account_exists message', async () => {
    mockApi([providers, { method: 'POST', path: '/auth/google', status: 409, body: { error: { code: 'account_exists', message: 'x' } } }]);
    const h = renderApp('/login');
    await waitFor(() => expect(init).not.toBeNull());
    await act(async () => init?.callback({ credential: 'tok' }));
    expect(await screen.findByText(en.errors.account_exists)).toBeInTheDocument();
    expect(h.location().pathname).toBe('/login');
  });
});
