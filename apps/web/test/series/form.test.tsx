import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { SeriesForm } from '../../src/series/SeriesForm';
import { SeriesPreviewList } from '../../src/series/SeriesPreviewList';
import type { SeriesPattern } from '../../src/series/types';
import { seriesPreview } from '../owner/fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const START: SeriesPattern = { weekdays: ['mon'], startTime: '10:00', slotCount: 1, firstDate: '2026-10-26', endDate: null, count: 10 };

function Harness({ onValue, slotTimes = ['10:00', '11:00'], slotMinutes = 60 }: { onValue: (p: SeriesPattern) => void; slotTimes?: string[]; slotMinutes?: number }) {
  const [value, setValue] = useState<SeriesPattern>(START);
  return (
    <I18nextProvider i18n={i18n}>
      <SeriesForm
        value={value}
        tone="portal"
        slotTimes={slotTimes}
        slotMinutes={slotMinutes}
        onChange={(p) => {
          setValue(p);
          onValue(p);
        }}
      />
    </I18nextProvider>
  );
}

describe('SeriesForm', () => {
  it('toggling weekdays and switching end mode updates the pattern', async () => {
    const user = userEvent.setup();
    let last = START;
    render(<Harness onValue={(p) => (last = p)} />);
    await user.click(screen.getByRole('button', { name: 'Wed' }));
    expect(last.weekdays).toEqual(['mon', 'wed']);
    await user.click(screen.getByRole('button', { name: 'Mon' }));
    expect(last.weekdays).toEqual(['wed']);

    await user.click(screen.getByRole('radio', { name: en.series.endsOnDate }));
    expect(last.count).toBeNull();
    expect(last.endDate).toBe('2026-10-26');
    await user.click(screen.getByRole('radio', { name: en.series.endsAfter }));
    expect(last.endDate).toBeNull();
    expect(last.count).toBe(10);

    await user.selectOptions(screen.getByLabelText(en.series.length), '2');
    expect(last.slotCount).toBe(2);
    await user.selectOptions(screen.getByLabelText(en.series.startTime), '11:00');
    expect(last.startTime).toBe('11:00');
  });
});

describe('SeriesForm length', () => {
  it('length options use the turf slot length even with a single slot', () => {
    render(<Harness onValue={() => {}} slotTimes={['10:00']} slotMinutes={90} />);
    const labels = Array.from((screen.getByLabelText(en.series.length) as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels.slice(0, 3)).toEqual(['1 h 30 min', '3 h', '4 h 30 min']);
  });

  it('count can be cleared and retyped', async () => {
    const user = userEvent.setup();
    let last = START;
    render(<Harness onValue={(p) => (last = p)} />);
    const input = screen.getByLabelText(en.series.count) as HTMLInputElement;
    await user.clear(input);
    expect(input.value).toBe('');
    await user.type(input, '12');
    expect(input.value).toBe('12');
    expect(last.count).toBe(12);
  });
});

describe('SeriesPreviewList', () => {
  it('preview list shows price for free dates and reason for clashes', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SeriesPreviewList preview={seriesPreview()} timeZone="Asia/Dhaka" />
      </I18nextProvider>,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText(/10\.00/)).toBeTruthy();
    expect(within(rows[1]!).getByText(en.series.reason.taken)).toBeTruthy();
    expect(screen.getByText(/2 games/)).toBeTruthy();
    expect(screen.getByText(/1 date skipped/)).toBeTruthy();
  });
});
