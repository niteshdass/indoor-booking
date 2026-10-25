import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import type { PublicUser } from '../../src/lib/types';

const user: PublicUser = {
  id: 'u1',
  name: 'Ada Player',
  email: 'ada@example.com',
  emailVerified: true,
  phone: '+8801712345678',
  hasPassword: true,
  hasGoogle: true,
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

describe('ProfilePage', () => {
  it('rename saves and shows new name in form', async () => {
    const api = mockApi([{ method: 'PATCH', path: '/me', body: { user: { ...user, name: 'New' } } }]);
    const h = renderApp('/profile', { user });
    const input = screen.getByLabelText(en.profile.name);
    expect(input).toHaveValue('Ada Player');
    await h.user.clear(input);
    await h.user.type(input, 'New');
    await h.user.click(screen.getByRole('button', { name: en.profile.save }));
    expect(await screen.findByText(en.profile.saved)).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'New' });
    expect(screen.getByLabelText(en.profile.name)).toHaveValue('New');
  });

  it('shows email, verified badge, phone and Google', () => {
    renderApp('/profile', { user });
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText(en.profile.verified)).toBeInTheDocument();
    expect(screen.getByText('+8801712345678')).toBeInTheDocument();
    expect(screen.getByText(en.profile.google)).toBeInTheDocument();
  });

  it('sign out returns home and shows sign-in link', async () => {
    mockApi([{ method: 'POST', path: '/auth/logout', status: 204 }]);
    const h = renderApp('/profile', { user });
    await h.user.click(screen.getByRole('button', { name: en.profile.signOut }));
    await waitFor(() => expect(h.location().pathname).toBe('/'));
    expect(await screen.findByRole('link', { name: en.nav.signIn })).toBeInTheDocument();
  });
});

describe('ResetPasswordPage', () => {
  it('reset without token shows invalid link message', () => {
    renderApp('/reset-password');
    expect(screen.getByText(en.auth.reset.invalid)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.auth.reset.requestNew })).toHaveAttribute('href', '/forgot-password');
  });

  it('posts token and password, then offers sign in', async () => {
    const api = mockApi([{ method: 'POST', path: '/auth/password/reset', status: 204 }]);
    const h = renderApp('/reset-password?token=abc');
    await h.user.type(screen.getByLabelText(en.auth.reset.newPassword), 'newpassword1');
    await h.user.click(screen.getByRole('button', { name: en.auth.reset.submit }));
    expect(await screen.findByText(en.auth.reset.success)).toBeInTheDocument();
    expect(api.calls[0]?.body).toEqual({ token: 'abc', password: 'newpassword1' });
    expect(screen.getByRole('link', { name: en.auth.reset.toLogin })).toHaveAttribute('href', '/login');
    await waitFor(() => expect(h.location().search).toBe(''));
  });

  it('invalid_reset_token shows message and request-new link', async () => {
    mockApi([{ method: 'POST', path: '/auth/password/reset', status: 400, body: { error: { code: 'invalid_reset_token', message: 'x' } } }]);
    const h = renderApp('/reset-password?token=bad');
    await h.user.type(screen.getByLabelText(en.auth.reset.newPassword), 'newpassword1');
    await h.user.click(screen.getByRole('button', { name: en.auth.reset.submit }));
    expect(await screen.findByText(en.errors.invalid_reset_token)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.auth.reset.requestNew })).toHaveAttribute('href', '/forgot-password');
  });
});

describe('ForgotPasswordPage', () => {
  it.each([['known@example.com'], ['unknown@example.com']])('forgot always shows sent for %s', async (email) => {
    const api = mockApi([{ method: 'POST', path: '/auth/password/forgot', status: 202, body: {} }]);
    const h = renderApp('/forgot-password');
    await h.user.type(screen.getByLabelText(en.auth.email), email);
    await h.user.click(screen.getByRole('button', { name: en.auth.forgot.submit }));
    expect(await screen.findByText(en.auth.forgot.sent)).toBeInTheDocument();
    expect(api.calls[0]?.body).toEqual({ email });
  });
});
