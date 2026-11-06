import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DateStepper } from '../../../src/owner/setup/DateStepper';
import { formatDay, monthWeeks, shiftMonth } from '../../../src/owner/setup/dates';
import { ThemeProvider } from '../../../src/theme/ThemeProvider';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const onChange = jest.fn();

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <DateStepper
      label="Ends"
      value={value}
      emptyLabel="No end"
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
    />
  );
}

const renderStepper = (initial: string) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <Harness initial={initial} />
      </ThemeProvider>
    </SafeAreaProvider>,
  );

beforeEach(() => onChange.mockClear());

describe('month helpers', () => {
  it('lays a month out in Monday-first weeks', () => {
    const weeks = monthWeeks('2026-11');
    // 1 Nov 2026 is a Sunday: six blanks, then the 1st.
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks.at(-1)).toEqual(['2026-11-30', null, null, null, null, null, null]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(monthWeeks('2027-02').flat().filter(Boolean)).toHaveLength(28);
  });

  it('moves across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
  });
});

describe('DateStepper', () => {
  it('still steps one day at a time', async () => {
    await renderStepper('2026-11-14');
    await fireEvent.press(screen.getByRole('button', { name: 'Day after' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-11-15');
  });

  it('picks a far date from the month calendar in a few taps', async () => {
    await renderStepper('2026-11-14');
    await fireEvent.press(screen.getByRole('button', { name: `Ends: ${formatDay('2026-11-14', 'en')}` }));
    expect(await screen.findByText('November 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: formatDay('2026-11-14', 'en') }).props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole('button', { name: 'Next month' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('January 2027')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: formatDay('2027-01-31', 'en') }));
    expect(onChange).toHaveBeenLastCalledWith('2027-01-31');
    expect(screen.queryByText('January 2027')).toBeNull();
    expect(screen.getByRole('button', { name: `Ends: ${formatDay('2027-01-31', 'en')}` })).toBeTruthy();
  });
});
