import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../src/i18n';
import { DateStrip } from '../../src/venue/DateStrip';
import { mockApi } from '../helpers/api';
import { renderApp } from '../helpers/render';
import type { PublicVenue } from '../../src/lib/types';

beforeEach(() => i18n.changeLanguage('en'));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('DateStrip', () => {
  it('14 chips starting today', () => {
    render(<DateStrip today="2026-10-24" value="2026-10-24" onChange={() => {}} timeZone="Asia/Dhaka" />);
    const chips = screen.getAllByRole('button');
    expect(chips).toHaveLength(14);
    expect(chips[0]).toHaveTextContent('Oct 24');
    expect(chips[13]).toHaveTextContent('Nov 6');
  });

  it('today has aria-current', () => {
    render(<DateStrip today="2026-10-24" value="2026-10-26" onChange={() => {}} timeZone="Asia/Dhaka" />);
    const current = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'date');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Oct 24');
  });

  it('click selects', async () => {
    const onChange = vi.fn();
    render(<DateStrip today="2026-10-24" value="2026-10-24" onChange={onChange} timeZone="Asia/Dhaka" />);
    await userEvent.click(screen.getByRole('button', { name: /Oct 27/ }));
    expect(onChange).toHaveBeenCalledWith('2026-10-27');
  });

  it('shows an out-of-range value as an extra first chip', () => {
    render(<DateStrip today="2026-10-24" value="2026-12-25" onChange={() => {}} timeZone="Asia/Dhaka" />);
    const chips = screen.getAllByRole('button');
    expect(chips).toHaveLength(15);
    expect(chips[0]).toHaveTextContent('Dec 25');
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('date strip starts at venue-local today', async () => {
    vi.setSystemTime(new Date('2026-01-01T20:00:00Z'));
    const venue: PublicVenue = {
      slug: 'a',
      name: 'Arena',
      address: 'Road 1',
      city: 'Dhaka',
      country: 'BD',
      currency: 'BDT',
      timezone: 'Asia/Dhaka',
      location: { lat: 1, lng: 2 },
      photos: [],
      amenities: [],
      turfs: [{ id: 't1', name: 'Court A', sports: ['futsal'], indoor: true, slotLengthMin: 60 }],
    };
    mockApi([{ path: '/venues/a', body: { venue } }]);
    renderApp('/venues/a');
    const strip = await screen.findByRole('group', { name: /date/i });
    const first = within(strip).getAllByRole('button')[0]!;
    expect(first).toHaveTextContent('Jan 2');
    expect(first).toHaveAttribute('aria-current', 'date');
  });
});
