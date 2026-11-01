import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { DEFAULT_OWNER_SETTINGS, type WeeklyHours } from '@booking/shared';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { HoursEditor } from '../../src/owner/settings/HoursEditor';
import { OwnerContext, type OwnerContextValue } from '../../src/owner/OwnerProvider';
import { SettingsForm } from '../../src/owner/settings/SettingsForm';
import { hoursPatch, settingsPatch, type StoredSettings } from '../../src/owner/settings/settingsPatch';
import { ApiError } from '../../src/lib/apiClient';
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

// Only what the payment fields read; the rest of the portal context is never touched here.
const owner = { ownerId: OWNER_ID, can: () => true } as unknown as OwnerContextValue;

type Section = 'hours' | 'booking' | 'payments' | 'refunds';

/** Renders the form on one settings tab (the tab lives in `?section=`). */
function renderForm(level: 'owner' | 'venue', over: Partial<React.ComponentProps<typeof SettingsForm>> = {}, section: Section = 'hours') {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter initialEntries={[section === 'hours' ? '/' : `/?section=${section}`]}>
      <OwnerContext.Provider value={owner}>
        <SettingsForm
          level={level}
          stored={level === 'owner' ? DEFAULTS : {}}
          effective={DEFAULTS}
          inherited={level === 'owner' ? null : DEFAULTS}
          currency="BDT"
          onSave={onSave}
          {...over}
        />
      </OwnerContext.Provider>
    </MemoryRouter>,
  );
  return onSave;
}

describe('SettingsForm', () => {
  it('owner level saves only the changed key and offers no inherit boxes', async () => {
    const user = userEvent.setup();
    const onSave = renderForm('owner', {}, 'booking');
    expect(screen.queryByLabelText(S.inherit)).toBeNull();
    const win = screen.getByLabelText(S.bookingWindow);
    await user.clear(win);
    await user.type(win, '45');
    await user.click(screen.getByRole('button', { name: S.save }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ bookingWindowDays: 45 }));
    expect(await screen.findByText(S.saved)).toBeTruthy();
  });

  it('owner level auto-reject card has its own heading', () => {
    renderForm('owner', {}, 'booking');
    const card = screen.getByRole('region', { name: S.autoRejectTitle });
    expect(within(card).getByLabelText(S.autoReject)).toBeTruthy();
  });

  it('refund rule remove is a visible secondary button', async () => {
    renderForm('owner', { effective: { ...DEFAULTS, refundRules: [{ minHoursBefore: 24, percent: 50 }] } }, 'refunds');
    expect(screen.getByRole('button', { name: i18n.t('owner.settings.removeRule', { n: 1 }) }).className).toMatch(/secondary/);
  });

  it('venue level inherit on refund rules sends null', async () => {
    const user = userEvent.setup();
    const stored: StoredSettings = { refundRules: [{ minHoursBefore: 24, percent: 50 }] };
    const onSave = renderForm('venue', { stored }, 'refunds');
    expect(screen.getAllByLabelText(S.inherit)).toHaveLength(1);
    await user.click(within(screen.getByRole('region', { name: S.refundTitle })).getByLabelText(S.inherit));
    await user.click(screen.getByRole('button', { name: S.save }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ refundRules: null }));
  });

  it('partial_fixed only offered at venue level and parsed to minor units', async () => {
    renderForm('owner', {}, 'payments');
    expect(screen.queryByRole('option', { name: S.payment.partial_fixed })).toBeNull();
  });

  it('venue level offers partial_fixed, parsed to minor units', async () => {
    const user = userEvent.setup();
    const onSave = renderForm('venue', { stored: { paymentPolicy: { type: 'none' } } }, 'payments');
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
    }, 'refunds');
    await user.click(screen.getByRole('button', { name: S.addRule }));
    const hours = screen.getAllByLabelText(S.refundHours);
    await user.clear(hours[1]!);
    await user.type(hours[1]!, '24');
    await user.click(screen.getByRole('button', { name: S.save }));
    expect((await screen.findAllByText(S.duplicate)).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('payment methods', () => {
  const PM = S.methods;

  it('owner turns on bKash with a number and saves', async () => {
    const user = userEvent.setup();
    const onSave = renderForm('owner', {}, 'payments');
    const card = screen.getByRole('region', { name: PM.title });
    await user.click(within(card).getByLabelText('bKash'));
    const number = within(card).getByLabelText(PM.number);
    expect(number.getAttribute('inputmode')).toBe('tel');
    await user.type(number, '01712345678');
    await user.click(screen.getByRole('button', { name: S.save }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const body = onSave.mock.calls[0]![0] as { paymentMethods: { manualWallets: unknown[] } };
    expect(body.paymentMethods.manualWallets[0]).toEqual({ provider: 'bkash', number: '01712345678', accountType: 'personal' });
  });

  it('shows a stored number formatted until it is edited', () => {
    renderForm('owner', {
      effective: { ...DEFAULTS, paymentMethods: { manualWallets: [{ provider: 'nagad', number: '+8801712345678', accountType: 'merchant' }], gateways: [] } },
    }, 'payments');
    expect((screen.getByLabelText(PM.number) as HTMLInputElement).value).toBe('+880 1712-345678');
  });

  it('venue inherits payment methods until overridden', async () => {
    const user = userEvent.setup();
    const onSave = renderForm('venue', {}, 'payments');
    const card = screen.getByRole('region', { name: PM.title });
    expect((within(card).getByLabelText('bKash') as HTMLInputElement).disabled).toBe(true);
    await user.click(within(card).getByLabelText(S.inherit));
    await user.click(within(card).getByLabelText('bKash'));
    await user.type(within(card).getByLabelText(PM.number), '01712345678');
    await user.click(screen.getByRole('button', { name: S.save }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toEqual({
      paymentMethods: { manualWallets: [{ provider: 'bkash', number: '01712345678', accountType: 'personal' }], gateways: [] },
    });
  });

  it('save error no_payment_method shows its message next to the group', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new ApiError(400, 'no_payment_method', 'x'));
    renderForm('owner', { onSave, effective: { ...DEFAULTS, bookingWindowDays: 30 } }, 'booking');
    await user.clear(screen.getByLabelText(S.bookingWindow));
    await user.type(screen.getByLabelText(S.bookingWindow), '31');
    await user.click(screen.getByRole('button', { name: S.save }));
    // The error switches the form to the Payments tab, which holds the methods card.
    const card = await screen.findByRole('region', { name: PM.title });
    expect(await within(card).findByText(en.errors.no_payment_method)).toBeTruthy();
  });

  it.each(['8801712345678', '1712345678', '+88017123'])('rejects %s client-side with one wallet error', async (num) => {
    const user = userEvent.setup();
    const onSave = renderForm('owner', {}, 'payments');
    await user.click(screen.getByLabelText('Nagad'));
    await user.type(screen.getByLabelText(PM.number), num);
    await user.click(screen.getByRole('button', { name: S.save }));
    expect(await screen.findAllByText(S.errors.wallet)).toHaveLength(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('accepts +880 and local forms', async () => {
    const user = userEvent.setup();
    const onSave = renderForm('owner', {}, 'payments');
    await user.click(screen.getByLabelText('Nagad'));
    await user.type(screen.getByLabelText(PM.number), '+880 1712-345678');
    await user.click(screen.getByRole('button', { name: S.save }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it('shows the connect hint only when it can help', () => {
    renderForm('owner', { canConnectGateways: false }, 'payments');
    expect(screen.queryByText(PM.connect.stripe)).toBeNull();
    expect(screen.queryByText(PM.connect.sslcommerz)).toBeNull();
    cleanup();
    renderForm('owner', { effective: { ...DEFAULTS, paymentMethods: { manualWallets: [], gateways: ['stripe'] } } }, 'payments');
    expect(screen.queryByText(PM.connect.stripe)).toBeNull();
    expect(screen.getByText(PM.connect.sslcommerz)).toBeTruthy();
  });

  it('card is disabled until Stripe is connected', async () => {
    const user = userEvent.setup();
    renderForm('owner', {}, 'payments');
    const card = screen.getByLabelText(PM.gateway.stripe) as HTMLInputElement;
    expect(card.disabled).toBe(true);
    expect(screen.getByText(PM.connect.stripe)).toBeTruthy();
    cleanup();
    const onSave = renderForm('owner', { readyGateways: ['stripe'] }, 'payments');
    await user.click(screen.getByLabelText(PM.gateway.stripe));
    await user.click(screen.getByRole('button', { name: S.save }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ paymentMethods: { manualWallets: [], gateways: ['stripe'] } }));
  });

  it('online checkout is disabled until SSLCommerz is connected, and links to its section', async () => {
    const user = userEvent.setup();
    renderForm('owner', { readyGateways: ['stripe'] }, 'payments');
    const online = screen.getByLabelText(PM.gateway.sslcommerz) as HTMLInputElement;
    expect(online.disabled).toBe(true);
    expect(screen.getByRole('link', { name: PM.connect.sslcommerz }).getAttribute('href')).toBe(
      `/owner/${OWNER_ID}/settings?section=sslcommerz`,
    );
    cleanup();
    const onSave = renderForm('owner', { readyGateways: ['sslcommerz'] }, 'payments');
    expect(screen.queryByText(PM.connect.sslcommerz)).toBeNull();
    await user.click(screen.getByLabelText(PM.gateway.sslcommerz));
    await user.click(screen.getByRole('button', { name: S.save }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ paymentMethods: { manualWallets: [], gateways: ['sslcommerz'] } }));
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
    renderApp(`/owner/${OWNER_ID}/settings?section=booking`, { user: staffUser });
    const win = await screen.findByLabelText(S.bookingWindow);
    await user.clear(win);
    await user.type(win, '60');
    await user.click(screen.getByRole('button', { name: S.save }));
    expect(await screen.findByText(S.saved)).toBeTruthy();
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ bookingWindowDays: 60 });
  });
});
