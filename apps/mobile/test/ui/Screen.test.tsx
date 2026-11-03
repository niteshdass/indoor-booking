import { render, screen } from '@testing-library/react-native';
import { Screen } from '../../src/ui/Screen';
import { Text } from '../../src/ui/Text';
import { ThemeProvider } from '../../src/theme/ThemeProvider';

describe('Screen', () => {
  it('scroll keeps taps working while the keyboard is up', async () => {
    await render(
      <ThemeProvider>
        <Screen scroll>
          <Text>hi</Text>
        </Screen>
      </ThemeProvider>,
    );
    let node = screen.getByText('hi').parent;
    while (node && node.type !== 'RCTScrollView') node = node.parent;
    expect(node?.props.keyboardShouldPersistTaps).toBe('handled');
  });
});
