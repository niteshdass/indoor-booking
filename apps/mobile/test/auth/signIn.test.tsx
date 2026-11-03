import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AuthContext, type AuthContextValue } from '../../src/auth/useAuth';
import { requireSignIn } from '../../src/auth/requireSignIn';
import { ApiError } from '../../src/lib/api';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import i18n from 'i18next';
import ru from '../../../web/src/i18n/locales/ru.json';
import SignInScreen from '../../app/sign-in';
import EmailSignIn from '../../app/sign-in/email';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));

const mockPost = jest.fn();
jest.mock('../../src/lib/api', () => {
  const actual = jest.requireActual('../../src/lib/api');
  return { ...actual, apiPost: (...a: unknown[]) => mockPost(...a) };
});

const user = { id: 'u1', name: 'A', email: null, emailVerified: false, phone: '+8801712345678', hasPassword: false, hasGoogle: false, platformAdmin: false };
const signIn = jest.fn(async () => undefined);
const auth: AuthContextValue = { status: 'signedOut', user: null, signIn, setUser: jest.fn(), signOut: jest.fn(), retry: jest.fn() };

function wrap(node: ReactNode) {
  return (
    <ThemeProvider>
      <AuthContext.Provider value={auth}>{node}</AuthContext.Provider>
    </ThemeProvider>
  );
}

async function requestCode() {
  await render(wrap(<SignInScreen />));
  await fireEvent.changeText(await screen.findByLabelText('Phone'), '+8801712345678');
  await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
  await screen.findByLabelText('Verification code');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockPost.mockImplementation(async (path: string) => {
    if (path === '/auth/otp/request') return { expiresInSec: 300, resendInSec: 60 };
    if (path === '/auth/otp/verify') return { user, accessToken: 'at', refreshToken: 'rt' };
    throw new Error(path);
  });
});

describe('sign-in', () => {
  it('OTP flow signs in and returns to next', async () => {
    mockParams = { next: '/venue/abc' };
    await requestCode();
    expect(mockPost).toHaveBeenCalledWith('/auth/otp/request', { phone: '+8801712345678' });
    await fireEvent.changeText(screen.getByLabelText('Verification code'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: 'Verify and sign in' }));
    await act(async () => {});
    expect(mockPost).toHaveBeenCalledWith('/auth/otp/verify', { phone: '+8801712345678', code: '123456' });
    expect(signIn).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'rt' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/venue/abc');
  });

  it('wrong code shows the translated error', async () => {
    await requestCode();
    mockPost.mockRejectedValueOnce(new ApiError(400, 'otp_invalid', 'bad'));
    await fireEvent.changeText(screen.getByLabelText('Verification code'), '000000');
    await fireEvent.press(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(await screen.findByText('That code is incorrect.')).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('shows the error in Russian when the language is ru', async () => {
    i18n.addResourceBundle('ru', 'translation', ru, true, true);
    await i18n.changeLanguage('ru');
    try {
      await render(wrap(<SignInScreen />));
      mockPost.mockRejectedValueOnce(new ApiError(400, 'otp_invalid', 'bad'));
      await fireEvent.changeText(await screen.findByLabelText(ru.auth.phone.label), '+79123456789');
      await fireEvent.press(screen.getByRole('button', { name: ru.auth.phone.sendCode }));
      expect(await screen.findByText(ru.errors.otp_invalid)).toBeTruthy();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('resend is disabled during cooldown', async () => {
    jest.useFakeTimers();
    try {
      await requestCode();
      const resend = screen.getByRole('button', { name: 'Resend code in 60s' });
      expect(resend.props.accessibilityState.disabled).toBe(true);
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      expect(screen.getByRole('button', { name: 'Resend code' }).props.accessibilityState.disabled).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('next=https://evil.com is ignored', async () => {
    mockParams = { next: 'https://evil.com' };
    await requestCode();
    await fireEvent.changeText(screen.getByLabelText('Verification code'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: 'Verify and sign in' }));
    await act(async () => {});
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it('next=//evil.com is ignored', async () => {
    mockParams = { next: '//evil.com' };
    await requestCode();
    await fireEvent.changeText(screen.getByLabelText('Verification code'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: 'Verify and sign in' }));
    await act(async () => {});
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it('email sign-in posts credentials and signs in', async () => {
    mockParams = { next: '/bookings' };
    mockPost.mockResolvedValueOnce({ user, accessToken: 'at', refreshToken: 'rt' });
    await render(wrap(<EmailSignIn />));
    await fireEvent.changeText(await screen.findByLabelText('Email address'), 'a@b.c');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret123');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await act(async () => {});
    expect(mockPost).toHaveBeenCalledWith('/auth/login', { email: 'a@b.c', password: 'secret123' });
    expect(mockRouter.replace).toHaveBeenCalledWith('/bookings');
  });
});

describe('requireSignIn', () => {
  it('pushes sign-in with an encoded in-app next', () => {
    const router = { push: jest.fn() };
    requireSignIn(router, '/venue/abc?x=1');
    expect(router.push).toHaveBeenCalledWith('/sign-in?next=%2Fvenue%2Fabc%3Fx%3D1');
  });
  it('falls back to / for a foreign next', () => {
    const router = { push: jest.fn() };
    requireSignIn(router, 'https://evil.com');
    expect(router.push).toHaveBeenCalledWith('/sign-in?next=%2F');
  });
});
