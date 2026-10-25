import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_OWNER_SETTINGS } from '@booking/shared';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, ownerRoutes, staffUser, venue } from './fixtures';

const S = en.owner.settings;
const G = en.owner.gateway;
const DEFAULTS = DEFAULT_OWNER_SETTINGS;
const GW = `/owners/${OWNER_ID}/payment-gateways`;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const view = (over: Record<string, unknown> = {}) => ({
  gateway: 'stripe',
  connected: true,
  enabled: true,
  mode: 'test',
  accountId: 'acct_123',
  publishableKey: 'pk_test_abc',
  webhookUrl: 'https://api.example.com/api/v1/webhooks/stripe/o1',
  webhookEvents: ['payment_intent.succeeded', 'charge.refunded'],
  updatedAt: null,
  ...over,
});

describe('VenueSettingsTab', () => {
  const TAB = `/owner/${OWNER_ID}/venues/v1?tab=settings`;
  const perms = ['booking.view', 'venue.manage'] as const;

  it('venue settings tab saves settings patch under the settings key', async () => {
    const user = userEvent.setup();
    const v = venue({ settings: {}, effectiveSettings: DEFAULTS });
    const saved = venue({ settings: { bookingWindowDays: 60 }, effectiveSettings: { ...DEFAULTS, bookingWindowDays: 60 } });
    const { calls } = mockApi([
      { method: 'PATCH', path: `/owners/${OWNER_ID}/venues/v1`, body: { venue: saved } },
      { path: `/owners/${OWNER_ID}/settings`, body: { settings: DEFAULTS } },
      ...ownerRoutes({ permissions: [...perms], venues: [v] }),
    ]);
    renderApp(TAB, { user: staffUser });
    await user.click(within(await screen.findByRole('region', { name: S.windowTitle })).getByLabelText(S.inherit));
    const win = screen.getByLabelText(S.bookingWindow);
    await user.clear(win);
    await user.type(win, '60');
    await user.click(screen.getByRole('button', { name: S.save }));
    expect(await screen.findByText(S.saved)).toBeTruthy();
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ settings: { bookingWindowDays: 60 } });
    // The venue list is refetched after a save.
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.path === `/owners/${OWNER_ID}/venues`).length).toBeGreaterThan(1));
  });

  it('venue settings tab shows inherited owner values', async () => {
    mockApi([
      { path: `/owners/${OWNER_ID}/settings`, body: { settings: { ...DEFAULTS, bookingWindowDays: 45 } } },
      ...ownerRoutes({ permissions: [...perms], venues: [venue({ settings: {}, effectiveSettings: DEFAULTS })] }),
    ]);
    renderApp(TAB, { user: staffUser });
    expect(((await screen.findByLabelText(S.bookingWindow)) as HTMLInputElement).value).toBe('45');
  });
});

describe('StripeGatewayCard', () => {
  const routes = (gw: unknown[], extra: Parameters<typeof mockApi>[0] = []) => [
    ...extra,
    { path: GW, body: gw },
    { path: `/owners/${OWNER_ID}/settings`, body: { settings: DEFAULTS } },
    ...ownerRoutes({ permissions: ['booking.view', 'settings.edit'] }),
  ];

  it('stripe card shows webhook url and toggles enabled', async () => {
    const user = userEvent.setup();
    const { calls } = mockApi(
      routes([view()], [{ method: 'PATCH', path: `${GW}/stripe`, body: { gateway: view({ enabled: false }) } }]),
    );
    renderApp(`/owner/${OWNER_ID}/settings`, { user: staffUser });
    expect(await screen.findByText('acct_123')).toBeTruthy();
    expect(screen.getByText(G.mode.test)).toBeTruthy();
    expect(screen.getByDisplayValue('https://api.example.com/api/v1/webhooks/stripe/o1')).toBeTruthy();
    expect(screen.getByText('charge.refunded')).toBeTruthy();
    await user.click(screen.getByLabelText(G.enabled));
    await waitFor(() => expect((screen.getByLabelText(G.enabled) as HTMLInputElement).checked).toBe(false));
    expect(calls.find((c) => c.method === 'PATCH' && c.path === `${GW}/stripe`)!.body).toEqual({ enabled: false });
  });

  it('stripe form rejects mixed test and live keys before posting', async () => {
    const user = userEvent.setup();
    const { calls } = mockApi(routes([view({ connected: false, enabled: false, mode: null, accountId: null, publishableKey: null })]));
    renderApp(`/owner/${OWNER_ID}/settings`, { user: staffUser });
    await user.type(await screen.findByLabelText(G.secretKey), 'sk_test_abc');
    await user.type(screen.getByLabelText(G.publishableKey), 'pk_live_abc');
    await user.type(screen.getByLabelText(G.webhookSecret), 'whsec_abc');
    await user.click(screen.getByRole('button', { name: G.connect }));
    expect(await screen.findByText(G.errors.mode)).toBeTruthy();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('stripe form clears secrets after connecting', async () => {
    const user = userEvent.setup();
    const { calls } = mockApi(
      routes(
        [view({ connected: false, enabled: false, mode: null, accountId: null, publishableKey: null })],
        [{ method: 'PUT', path: `${GW}/stripe`, body: { gateway: view({ mode: 'live', accountId: 'acct_999' }) } }],
      ),
    );
    renderApp(`/owner/${OWNER_ID}/settings`, { user: staffUser });
    const secret = (await screen.findByLabelText(G.secretKey)) as HTMLInputElement;
    expect(secret.type).toBe('password');
    expect(secret.autocomplete).toBe('off');
    await user.type(secret, 'sk_test_abc');
    await user.type(screen.getByLabelText(G.publishableKey), 'pk_test_abc');
    await user.type(screen.getByLabelText(G.webhookSecret), 'whsec_abc');
    await user.click(screen.getByRole('button', { name: G.connect }));
    expect(await screen.findByText('acct_999')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      secretKey: 'sk_test_abc',
      publishableKey: 'pk_test_abc',
      webhookSecret: 'whsec_abc',
    });
    // Replace keys reopens an empty form.
    await user.click(screen.getByRole('button', { name: G.replace }));
    expect((screen.getByLabelText(G.secretKey) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(G.webhookSecret) as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain('sk_test_abc');
  });
});
