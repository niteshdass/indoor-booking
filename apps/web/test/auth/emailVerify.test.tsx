import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
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
  emailVerified: false,
  phone: '+8801712345678',
  hasPassword: true,
  hasGoogle: false,
  platformAdmin: false,
};
const otpSent = { expiresInSec: 300, resendInSec: 60 };
const message = en.verifyEmail.message.replace('{{email}}', 'ada@example.com');

beforeEach(async () => {
  await i18n.changeLanguage('en');
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

describe('EmailVerifyNotice', () => {
  it('sends a code, verifies it and shows the success state', async () => {
    const api = mockApi([
      { method: 'POST', path: '/me/email/verify/request', status: 202, body: otpSent },
      { method: 'POST', path: '/me/email/verify', body: { user: { ...user, emailVerified: true } } },
    ]);
    const h = renderApp('/profile', { user });
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByText(en.profile.notVerified)).toBeInTheDocument();
    await h.user.click(screen.getByRole('button', { name: en.verifyEmail.send }));
    await screen.findByRole('group', { name: en.verifyEmail.code });
    expect(screen.getByRole('button', { name: /Resend/ })).toBeDisabled();
    await h.user.click(screen.getAllByRole('textbox', { name: /Digit 1/ }).at(-1)!);
    await h.user.keyboard('123456');
    await h.user.click(screen.getByRole('button', { name: en.verifyEmail.verify }));
    expect(await screen.findByText(en.verifyEmail.done)).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === '/me/email/verify')?.body).toEqual({ code: '123456' });
    expect(screen.getByText(en.profile.verified)).toBeInTheDocument();
    await h.user.click(screen.getByRole('button', { name: en.verifyEmail.dismiss }));
    expect(screen.queryByText(en.verifyEmail.done)).not.toBeInTheDocument();
  });

  it('a wrong code shows the error and keeps the code step', async () => {
    mockApi([
      { method: 'POST', path: '/me/email/verify/request', status: 202, body: otpSent },
      { method: 'POST', path: '/me/email/verify', status: 400, body: { error: { code: 'otp_invalid', message: 'x' } } },
    ]);
    const h = renderApp('/profile', { user });
    await h.user.click(screen.getByRole('button', { name: en.verifyEmail.send }));
    await screen.findByRole('group', { name: en.verifyEmail.code });
    await h.user.click(screen.getAllByRole('textbox', { name: /Digit 1/ }).at(-1)!);
    await h.user.keyboard('000000');
    await h.user.click(screen.getByRole('button', { name: en.verifyEmail.verify }));
    expect(await screen.findByText(en.errors.otp_invalid)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: en.verifyEmail.code })).toBeInTheDocument();
  });

  it('Later hides it for the session', async () => {
    mockApi([]);
    const h = renderApp('/profile', { user });
    await h.user.click(screen.getByRole('button', { name: en.verifyEmail.later }));
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(sessionStorage.getItem('emailVerifyLater:u1')).toBe('1');
  });

  it('is not shown for a verified email or an account without one', () => {
    mockApi([]);
    const first = renderApp('/profile', { user: { ...user, emailVerified: true } });
    expect(screen.queryByRole('region', { name: en.verifyEmail.label })).not.toBeInTheDocument();
    first.unmount();
    renderApp('/profile', { user: { ...user, email: null } });
    expect(screen.queryByRole('region', { name: en.verifyEmail.label })).not.toBeInTheDocument();
  });
});
