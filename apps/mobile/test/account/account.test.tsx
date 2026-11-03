import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AuthContext, type AuthContextValue } from '../../src/auth/useAuth';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import AccountScreen from '../../app/(tabs)/account';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({}) }));

const mockPatch = jest.fn();
jest.mock('../../src/lib/api', () => {
  const actual = jest.requireActual('../../src/lib/api');
  return { ...actual, apiPatch: (...a: unknown[]) => mockPatch(...a) };
});
const mockSetLanguage = jest.fn(async (_l: string) => undefined);
jest.mock('../../src/i18n', () => ({
  ...jest.requireActual('../../src/i18n'),
  setLanguage: (l: string) => mockSetLanguage(l),
}));

const user = { id: 'u1', name: 'Asha', email: 'a@b.c', emailVerified: true, phone: '+8801712345678', hasPassword: true, hasGoogle: false, platformAdmin: false };
const signOut = jest.fn(async () => undefined);
const setUser = jest.fn();
const base: AuthContextValue = { status: 'signedIn', user, signIn: jest.fn(), setUser, signOut, retry: jest.fn() };

const tree = (value: Partial<AuthContextValue> = {}) => (
  <ThemeProvider>
    <AuthContext.Provider value={{ ...base, ...value }}>
      <AccountScreen />
    </AuthContext.Provider>
  </ThemeProvider>
);
const renderAccount = (value: Partial<AuthContextValue> = {}) => render(tree(value));

beforeEach(() => jest.clearAllMocks());

describe('account', () => {
  it('shows name, email and phone', async () => {
    await renderAccount();
    expect(await screen.findByDisplayValue('Asha')).toBeTruthy();
    expect(screen.getByText('a@b.c')).toBeTruthy();
    expect(screen.getByText('+8801712345678')).toBeTruthy();
  });

  it('edits the name with PATCH /me', async () => {
    mockPatch.mockResolvedValue({ user: { ...user, name: 'Bea' } });
    await renderAccount();
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Bea');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await act(async () => {});
    expect(mockPatch).toHaveBeenCalledWith('/me', { name: 'Bea' });
    expect(setUser).toHaveBeenCalledWith({ ...user, name: 'Bea' });
  });

  it('switches language', async () => {
    await renderAccount();
    await fireEvent.press(await screen.findByRole('button', { name: 'Русский' }));
    expect(mockSetLanguage).toHaveBeenCalledWith('ru');
  });

  it('sign out asks to confirm and lands on the Find tab', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderAccount();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }));
    expect(signOut).not.toHaveBeenCalled();
    const [title, , buttons] = alert.mock.calls[0];
    expect(title).toBe('Sign out?');
    const confirm = buttons!.find((b) => b.style === 'destructive')!;
    await act(async () => {
      await confirm.onPress?.();
    });
    expect(signOut).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it('signed out shows a sign-in prompt', async () => {
    await renderAccount({ status: 'signedOut', user: null });
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign in' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-in?next=%2Faccount');
  });

  it('fills the name when the session arrives after mount', async () => {
    const { rerender } = await renderAccount({ status: 'loading', user: null });
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    await rerender(tree({ user: { ...user, name: 'Rafi' } }));
    expect(await screen.findByDisplayValue('Rafi')).toBeTruthy();
  });

  it('offline shows the message and Retry calls retry', async () => {
    const retry = jest.fn();
    await renderAccount({ status: 'offline', user: null, retry });
    expect(screen.getByText(/can't reach the server/i)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});
