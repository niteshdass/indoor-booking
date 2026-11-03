import { fireEvent, render, screen } from '@testing-library/react-native';
import { BackButton } from '../../src/ui/BackButton';
import { ThemeProvider } from '../../src/theme/ThemeProvider';

const mockRouter = { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const renderBack = () =>
  render(
    <ThemeProvider>
      <BackButton />
    </ThemeProvider>,
  );

describe('BackButton', () => {
  beforeEach(() => jest.clearAllMocks());

  it('goes back when there is history', async () => {
    mockRouter.canGoBack.mockReturnValue(true);
    await renderBack();
    fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('goes to Find when opened cold', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    await renderBack();
    fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});
