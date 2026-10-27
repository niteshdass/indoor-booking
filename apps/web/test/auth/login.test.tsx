import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
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
const authRes = { user, accessToken: 'tok', refreshToken: 'r' };
const otpSent = { expiresInSec: 300, resendInSec: 60 };

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

async function requestCode(h: ReturnType<typeof renderApp>) {
  await h.user.type(screen.getByLabelText(en.auth.phone.number), '1712345678');
  await h.user.click(screen.getByRole('button', { name: en.auth.phone.sendCode }));
  await screen.findByRole('group', { name: en.auth.phone.code });
}

describe('LoginPage', () => {
  it('phone OTP signs in and returns to next', async () => {
    const api = mockApi([
      { method: 'POST', path: '/auth/otp/request', status: 202, body: otpSent },
      { method: 'POST', path: '/auth/otp/verify', body: authRes },
    ]);
    const h = renderApp('/login?next=%2Fme%2Fbookings');
    await requestCode(h);
    expect(api.calls.find((c) => c.path === '/auth/otp/request')?.body).toEqual({ phone: '+8801712345678' });
    await h.user.click(screen.getAllByRole('textbox')[0]!);
    await h.user.keyboard('123456');
    await h.user.click(screen.getByRole('button', { name: en.auth.phone.verify }));
    expect(await screen.findByRole('heading', { name: en.myBookings.title })).toBeInTheDocument();
    expect(h.location().pathname).toBe('/me/bookings');
    expect(api.calls.find((c) => c.path === '/auth/otp/verify')?.body).toEqual({ phone: '+8801712345678', code: '123456' });
  });

  it('resend disabled during cooldown', async () => {
    mockApi([{ method: 'POST', path: '/auth/otp/request', status: 202, body: otpSent }]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const h = renderApp('/login');
    await requestCode(h);
    const resend = screen.getByRole('button', { name: /Resend/ });
    expect(resend).toBeDisabled();
    expect(resend).toHaveTextContent('60');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole('button', { name: en.auth.phone.resend })).toBeEnabled();
  });

  it('wrong code shows otp_invalid message', async () => {
    mockApi([
      { method: 'POST', path: '/auth/otp/request', status: 202, body: otpSent },
      { method: 'POST', path: '/auth/otp/verify', status: 400, body: { error: { code: 'otp_invalid', message: 'x' } } },
    ]);
    const h = renderApp('/login');
    await requestCode(h);
    await h.user.click(screen.getAllByRole('textbox')[0]!);
    await h.user.keyboard('123456');
    await h.user.click(screen.getByRole('button', { name: en.auth.phone.verify }));
    expect(await screen.findByText(en.errors.otp_invalid)).toBeInTheDocument();
  });

  it('email login', async () => {
    const api = mockApi([{ method: 'POST', path: '/auth/login', body: authRes }]);
    const h = renderApp('/login');
    await h.user.click(screen.getByRole('tab', { name: en.auth.tabs.email }));
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
    await h.user.type(screen.getByLabelText(en.auth.email), 'ada@example.com');
    await h.user.type(screen.getByLabelText(en.auth.password), 'secret123');
    await h.user.click(screen.getByRole('button', { name: en.auth.login.submit }));
    await waitFor(() => expect(h.location().pathname).toBe('/'));
    expect(api.calls.find((c) => c.path === '/auth/login')?.body).toEqual({ email: 'ada@example.com', password: 'secret123' });
  });

  it('invalid credentials message', async () => {
    mockApi([{ method: 'POST', path: '/auth/login', status: 401, body: { error: { code: 'invalid_credentials', message: 'x' } } }]);
    const h = renderApp('/login');
    await h.user.click(screen.getByRole('tab', { name: en.auth.tabs.email }));
    await h.user.type(screen.getByLabelText(en.auth.email), 'ada@example.com');
    await h.user.type(screen.getByLabelText(en.auth.password), 'bad');
    await h.user.click(screen.getByRole('button', { name: en.auth.login.submit }));
    expect(await screen.findByText(en.errors.invalid_credentials)).toBeInTheDocument();
  });

  it('links to register with next and forgot-password', () => {
    mockApi([]);
    renderApp('/login?next=%2Fme%2Fbookings');
    expect(screen.getByRole('link', { name: en.auth.login.toRegister })).toHaveAttribute('href', '/register?next=%2Fme%2Fbookings');
    expect(screen.getByRole('link', { name: en.auth.login.forgot })).toHaveAttribute('href', '/forgot-password');
  });

  it('signed-in user visiting /login is redirected', () => {
    mockApi([]);
    const h = renderApp('/login?next=%2Fme%2Fbookings', { user });
    expect(h.location().pathname).toBe('/me/bookings');
  });
});

describe('RegisterPage', () => {
  const sendRoute = { method: 'POST', path: '/auth/register/otp/request', status: 202, body: otpSent };

  async function fill(h: ReturnType<typeof renderApp>) {
    await h.user.type(screen.getByLabelText(en.auth.phone.number), '1712345678');
    await h.user.click(screen.getByRole('button', { name: en.auth.phone.sendCode }));
    await screen.findByRole('group', { name: en.auth.phone.code });
    await h.user.click(screen.getAllByRole('textbox')[0]!);
    await h.user.keyboard('123456');
    await h.user.type(screen.getByLabelText(en.auth.name), 'Ada');
    await h.user.type(screen.getByLabelText(en.auth.email), 'ada@example.com');
    await h.user.type(screen.getByLabelText(en.auth.password), 'secret123');
    await h.user.click(screen.getByRole('button', { name: en.auth.register.submit }));
  }

  it('asks for the phone first, without the account fields', () => {
    mockApi([]);
    renderApp('/register');
    expect(screen.getByText(en.auth.register.phoneFirst)).toBeInTheDocument();
    expect(screen.getByLabelText(en.auth.phone.number)).toBeInTheDocument();
    expect(screen.queryByLabelText(en.auth.email)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.auth.register.submit })).not.toBeInTheDocument();
  });

  it('verifies the phone, registers, then signed in', async () => {
    const api = mockApi([sendRoute, { method: 'POST', path: '/auth/register', status: 201, body: authRes }]);
    const h = renderApp('/register?next=%2Fme%2Fbookings');
    await fill(h);
    await waitFor(() => expect(h.location().pathname).toBe('/me/bookings'));
    expect(api.calls.find((c) => c.path === '/auth/register/otp/request')?.body).toEqual({ phone: '+8801712345678' });
    expect(api.calls.find((c) => c.path === '/auth/register')?.body).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'secret123',
      phone: '+8801712345678',
      code: '123456',
    });
  });

  it('a number with an account shows phone_in_use and a sign-in link', async () => {
    mockApi([{ method: 'POST', path: '/auth/register/otp/request', status: 409, body: { error: { code: 'phone_in_use', message: 'x' } } }]);
    const h = renderApp('/register?next=%2Fme%2Fbookings');
    await h.user.type(screen.getByLabelText(en.auth.phone.number), '1712345678');
    await h.user.click(screen.getByRole('button', { name: en.auth.phone.sendCode }));
    expect(await screen.findByText(en.errors.phone_in_use)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.auth.register.toLogin })).toHaveAttribute('href', '/login?next=%2Fme%2Fbookings');
  });

  it('register email_in_use shows login link and keeps the code step', async () => {
    mockApi([sendRoute, { method: 'POST', path: '/auth/register', status: 409, body: { error: { code: 'email_in_use', message: 'x' } } }]);
    const h = renderApp('/register?next=%2Fme%2Fbookings');
    await fill(h);
    expect(await screen.findByText(en.errors.email_in_use)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.auth.register.toLogin })).toHaveAttribute('href', '/login?next=%2Fme%2Fbookings');
    expect(screen.getByLabelText(en.auth.email)).toHaveValue('ada@example.com');
  });

  it('signed-in user visiting /register is redirected', () => {
    mockApi([]);
    const h = renderApp('/register', { user });
    expect(h.location().pathname).toBe('/');
  });
});
