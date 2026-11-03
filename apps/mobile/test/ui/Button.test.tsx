import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Button } from '../../src/ui/Button';
import { ThemeProvider } from '../../src/theme/ThemeProvider';

describe('Button', () => {
  it('renders its label as an accessible button at least 44pt tall', async () => {
    await render(
      <ThemeProvider>
        <Button label="Book now" onPress={() => {}} />
      </ThemeProvider>,
    );
    const button = await screen.findByRole('button', { name: 'Book now' });
    expect(button.props.accessibilityRole).toBe('button');
    expect(screen.getByText('Book now')).toBeTruthy();
    const style = StyleSheet.flatten(button.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });
});
