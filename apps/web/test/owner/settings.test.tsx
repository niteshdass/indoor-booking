import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_OWNER_SETTINGS, type WeeklyHours } from '@booking/shared';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { HoursEditor } from '../../src/owner/settings/HoursEditor';
import { SettingsForm } from '../../src/owner/settings/SettingsForm';
import { hoursPatch, settingsPatch, type StoredSettings } from '../../src/owner/settings/settingsPatch';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, ownerRoutes, staffUser } from './fixtures';

const S = en.owner.settings;
const DEFAULTS = DEFAULT_OWNER_SETTINGS;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

describe('settingsPatch', () => {
  it('settings form patches only changed keys and null for inherit', () => {
    expect(settingsPatch('owner', DEFAULTS, { ...DEFAULTS })).toEqual({});
    expect(settingsPatch('owner', DEFAULTS, { ...DEFAULTS, bookingWindowDays: 45 })).toEqual({ bookingWindowDays: 45 });

    const stored: StoredSettings = {
      refundRules: [{ minHoursBefore: 24, percent: 100 }],
      hours: { mon: { open: '09:00', close: '18:00' } },
    };
    const withoutRefund: StoredSettings = { hours: stored.hours };
    expect(settingsPatch('venue', stored, withoutRefund)).toEqual({ refundRules: null });
    expect(
      settingsPatch('venue', stored, { ...stored, hours: { mon: { open: '10:00', close: '18:00' } } }),
    ).toEqual({ hours: { mon: { open: '10:00', close: '18:00' } } });
    // Whole-hours inherit.
    const withoutHours: StoredSettings = { refundRules: stored.refundRules };
    expect(settingsPatch('venue', stored, withoutHours)).toEqual({ hours: null });
  });

  it('hoursPatch diffs per day and only emits null when allowed', () => {
    const before: Partial<WeeklyHours> = { mon: { open: '09:00', close: '18:00' }, tue: 'closed' };
    expect(hoursPatch(before, { ...before }, true)).toBeUndefined();
    expect(hoursPatch(before, { mon: before.mon, tue: 'closed', wed: 'closed' }, true)).toEqual({ wed: 'closed' });
    expect(hoursPatch(before, { mon: before.mon }, true)).toEqual({ tue: null });
    expect(hoursPatch(before, { mon: before.mon }, false)).toBeUndefined();
    expect(hoursPatch(before, { mon: { open: '10:00', close: '18:00' }, tue: 'closed' }, false)).toEqual({
      mon: { open: '10:00', close: '18:00' },
    });
  });
});

describe('HoursEditor', () => {
  it('hours editor shows next-day hint when close is before open', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<HoursEditor value={{ mon: { open: '18:00', close: '02:00' }, tue: { open: '08:00', close: '22:00' } }} onChange={onChange} />);
    expect(screen.getAllByText(en.owner.hours.nextDay)).toHaveLength(1);
    // Locale weekday names, not hardcoded.
    expect(screen.getByLabelText('Monday')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Tuesday'), 'closed');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tue: 'closed' }));
  });

  it('inherit rows are absent from value and show the inherited line', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<HoursEditor value={{}} inherited={DEFAULTS.hours} onChange={onChange} />);
    expect(screen.getAllByText('Inherited: 08:00 – 22:00')).toHaveLength(7);
    await user.selectOptions(screen.getByLabelText('Monday'), 'closed');
    expect(onChange).toHaveBeenCalledWith({ mon: 'closed' });
  });
});

function renderForm(level: 'owner' | 'venue', over: Partial<React.ComponentProps<typeof SettingsForm>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <SettingsForm
      level={level}
      stored={level === 'owner' ? DEFAULTS : {}}
      effective={DEFAULTS}
      inherited={level === 'owner' ? null : DEFAULTS}
      currency="BDT"
      onSave={onSave}
      {...over}
    />,
  );
  return onSave;
}

describe('SettingsForm', () => {
  it('owner level saves only the changed key and offers no inherit boxes', async () => {
    const user = userEvent.setup();
    const onSave = renderForm('owner');
    expect(screen.queryByLabelText(S.inherit)).toBeNull();
    const win = screen.getByLabelText(S.bookingWindow);
    await user.clear(win);
    await user.type(win, '45');
    await user.click(screen.getByRole('button', { name: S.save }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ bookingWindowDays: 45 }));
    expect(await screen.findByText(S.saved)).toBeTruthy();
  });

  it('owner level auto-reject card has its own heading', () => {
    renderForm('owner');
    const card = screen.getByRole('region', { name: S.autoRejectTitle });
    expect(within(card).getByLabelText(S.autoReject)).toBeTruthy();
  });

  it('refund rule remove is a visible secondary button', async () => {
    renderForm('owner', { effective: { ...DEFAULTS, refundRules: [{ minHoursBefore: 24, percent: 50 }] } });
    expect(screen.getByRole('button', { name: i18n.t('owner.settings.removeRule', { n: 1 }) }).className).toMatch(/secondary/);
  });

  it('venue level inherit on refund rules sends null', async () => {
    const user = userEvent.setup();
    const stored: StoredSettings = { refundRules: [{ minHoursBefore: 24, percent: 50 }] };
    const onSave = renderForm('venue', { stored });
    const boxes = screen.getAllByLabelText(S.inherit);
    expect(boxes.length).toBe(6);
    await user.click(within(screen.getByRole('region', { name: S.refundTitle })).getByLabelText(S.inherit));
    await user.click(screen.getByRole('button', { name: S.save }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ refundRules: null }));
  });

  it('partial_fixed only offered at venue level and parsed to minor units', async () => {
    renderForm('owner');
    expect(screen.queryByRole('option', { name: S.payment.partial_fixed })).toBeNull();
  });

  it('venue level offers partial_fixed, parsed to minor units', async () => {
    const user = userEvent.setup();
    const onSave = renderForm('venue', { stored: { paymentPolicy: { type: 'none' } } });
    await user.selectOptions(screen.getByLabelText(S.paymentType), 'partial_fixed');
    await user.type(screen.getByLabelText(S.amount.replace('{{currency}}', 'BDT')), '25.50');
    expect(screen.getByText(S.paymentNote)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: S.save }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ paymentPolicy: { type: 'partial_fixed', amount: 2550 } }));
  });

  it('duplicate refund thresholds block save', async () => {
    const user = userEvent.setup();
    const onSave = renderForm('owner', {
      stored: { ...DEFAULTS, refundRules: [{ minHoursBefore: 24, percent: 100 }] },
      effective: { ...DEFAULTS, refundRules: [{ minHoursBefore: 24, percent: 100 }] },
    });
    await user.click(screen.getByRole('button', { name: S.addRule }));
    const hours = screen.getAllByLabelText(S.refundHours);
    await user.clear(hours[1]!);
    await user.type(hours[1]!, '24');
    await user.click(screen.getByRole('button', { name: S.save }));
    expect((await screen.findAllByText(S.duplicate)).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('SettingsPage', () => {
  it('settings page saves and shows confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = mockApi([
      {
        method: 'PATCH',
        path: `/owners/${OWNER_ID}/settings`,
        body: { settings: { ...DEFAULTS, bookingWindowDays: 60 } },
      },
      { path: `/owners/${OWNER_ID}/settings`, body: { settings: DEFAULTS } },
      ...ownerRoutes({ permissions: ['booking.view', 'settings.edit'] }),
    ]);
    renderApp(`/owner/${OWNER_ID}/settings`, { user: staffUser });
    const win = await screen.findByLabelText(S.bookingWindow);
    await user.clear(win);
    await user.type(win, '60');
    await user.click(screen.getByRole('button', { name: S.save }));
    expect(await screen.findByText(S.saved)).toBeTruthy();
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ bookingWindowDays: 60 });
  });
});
