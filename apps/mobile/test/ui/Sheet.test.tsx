import * as RN from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { Field, Sheet } from '../../src/ui';

const os = RN.Platform.OS;
afterEach(() => {
  RN.Platform.OS = os;
  jest.restoreAllMocks();
});

const renderSheet = () =>
  render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <ThemeProvider>
        <Sheet visible onClose={() => {}} title="Cancel booking">
          <Field label="Reason" value="" onChangeText={() => {}} />
        </Sheet>
      </ThemeProvider>
    </SafeAreaProvider>,
  );

describe('Sheet', () => {
  it.each(['ios', 'android'] as const)('moves above the keyboard on %s', async (platform) => {
    RN.Platform.OS = platform;
    const Real = RN.KeyboardAvoidingView;
    const behaviors: unknown[] = [];
    // The module object Sheet reads from, not the namespace copy above.
    jest.spyOn(jest.requireActual<typeof RN>('react-native'), 'KeyboardAvoidingView', 'get').mockReturnValue(((props: RN.KeyboardAvoidingViewProps) => {
      behaviors.push(props.behavior);
      return <Real {...props} />;
    }) as unknown as typeof RN.KeyboardAvoidingView);
    await renderSheet();
    expect(screen.getByText('Cancel booking')).toBeTruthy();
    // Edge-to-edge Android no longer resizes the window for the keyboard, so the sheet pads itself there too.
    expect(behaviors.length).toBeGreaterThan(0);
    expect(behaviors.every((b) => b === 'padding')).toBe(true);
  });
});
