import { SafeAreaProvider } from 'react-native-safe-area-context';
import { render, screen } from '@testing-library/react-native';
import OwnerLayout from '../../../app/owner/_layout';
import type { AuthStatus } from '../../../src/auth/useAuth';
import { ThemeProvider } from '../../../src/theme/ThemeProvider';

let mockStatus: AuthStatus = 'loading';
jest.mock('../../../src/auth/useAuth', () => ({ useAuth: () => ({ status: mockStatus, retry: jest.fn() }) }));
jest.mock('expo-router', () => {
  const { Text: T } = jest.requireActual('react-native');
  return {
    usePathname: () => '/owner/o1/today',
    Redirect: ({ href }: { href: string }) => <T>{`redirect:${href}`}</T>,
    Stack: () => <T>owner screens</T>,
    router: { back: jest.fn(), canGoBack: () => false, replace: jest.fn() },
    useRouter: () => ({ back: jest.fn(), canGoBack: () => false, replace: jest.fn() }),
  };
});

const show = () =>
  render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <ThemeProvider>
        <OwnerLayout />
      </ThemeProvider>
    </SafeAreaProvider>,
  );

describe('owner layout', () => {
  it('waits for the session before any owner screen loads', async () => {
    mockStatus = 'loading';
    await show();
    expect(screen.queryByText('owner screens')).toBeNull();
  });

  it('sends a signed-out user to sign-in, back to the same screen after', async () => {
    mockStatus = 'signedOut';
    await show();
    expect(screen.getByText(`redirect:/sign-in?next=${encodeURIComponent('/owner/o1/today')}`)).toBeTruthy();
  });

  it('shows the owner screens once signed in', async () => {
    mockStatus = 'signedIn';
    await show();
    expect(screen.getByText('owner screens')).toBeTruthy();
  });
});
