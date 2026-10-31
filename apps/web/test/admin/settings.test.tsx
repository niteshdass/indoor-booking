import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { AdminSettingsJson } from '@booking/shared';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import type { PublicUser } from '../../src/lib/types';
import { mockApi, type Route } from '../helpers/api';
import { renderApp } from '../helpers/render';
import { staffUser } from '../owner/fixtures';

const admin: PublicUser = { ...staffUser, id: 'u-admin', name: 'Ada Admin', platformAdmin: true };
const ME = { role: { key: 'super_admin', name: 'Super Admin' }, permissions: ['platform.view', 'platform.settings'] };
const CLIENT_ID = '1234-abc.apps.googleusercontent.com';
const SID = 'AC' + 'a'.repeat(32);
const s = en.admin.settings;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

function settings(over: Partial<AdminSettingsJson> = {}): AdminSettingsJson {
  return {
    google: { source: 'none', clientId: null },
    email: { source: 'none', smtp: null },
    sms: { source: 'none', twilio: null },
    general: {
      ownerApproval: 'manual',
      fee: { mode: 'free', fixed: null, percent: null, payer: 'owner' },
      payout: { bkash: null, nagad: null, stripe: null },
      payoutWebhookUrl: 'http://localhost:4000/api/v1/webhooks/stripe/platform',
    },
    secretsAvailable: true,
    updatedAt: null,
    updatedBy: null,
    ...over,
  };
}

const routes = (extra: Route[] = [], data = settings()): Route[] => [
  { path: '/admin/me', body: ME },
  ...extra,
  { method: 'GET', path: '/admin/settings', body: data },
];

const card = (name: string) => screen.findByRole('region', { name });

describe('admin settings', () => {
  it('is in the admin nav and shows where each value comes from', async () => {
    mockApi(routes([], settings({ google: { source: 'server', clientId: 'env.apps.googleusercontent.com' } })));
    const h = renderApp('/admin/settings?section=google', { user: admin });
    const google = await card(s.google.title);
    expect(within(google).getByText(s.source.server)).toBeInTheDocument();
    expect(within(google).getByText('env.apps.googleusercontent.com')).toBeInTheDocument();
    expect(within(google).queryByRole('button', { name: s.remove })).not.toBeInTheDocument();
    expect(screen.getByText(window.location.origin)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: s.email.title })).not.toBeInTheDocument();
    expect(h.container.querySelector('a[href="/admin/settings"]')).not.toBeNull();

    await h.user.click(screen.getByRole('tab', { name: s.tab.email }));
    expect(within(await card(s.email.title)).getByText(s.source.none)).toBeInTheDocument();
    expect(h.location().search).toBe('?section=email');
  });

  it('saves the Google client ID', async () => {
    const api = mockApi(
      routes([{ method: 'PUT', path: '/admin/settings/google', body: settings({ google: { source: 'admin', clientId: CLIENT_ID }, updatedAt: '2026-10-30T10:00:00.000Z', updatedBy: 'Ada Admin' }) }]),
    );
    const h = renderApp('/admin/settings?section=google', { user: admin });
    const google = await card(s.google.title);
    await h.user.type(within(google).getByLabelText(s.google.clientId), ` ${CLIENT_ID} `);
    await h.user.click(within(google).getByRole('button', { name: s.save }));
    await waitFor(() => expect(within(google).getByText(s.source.admin)).toBeInTheDocument());
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ clientId: CLIENT_ID });
    expect(within(google).getByRole('button', { name: s.remove })).toBeInTheDocument();
    expect(screen.getByText(/Ada Admin/, { selector: 'p' })).toBeInTheDocument();
  });

  it('keeps a saved Twilio token when the field is left blank, and can fall back to the server', async () => {
    const saved = settings({ sms: { source: 'admin', twilio: { accountSid: SID, from: '+15550001111', authTokenSet: true } } });
    const api = mockApi(
      routes(
        [
          { method: 'PUT', path: '/admin/settings/sms', body: saved },
          { method: 'DELETE', path: '/admin/settings/sms', body: settings() },
        ],
        saved,
      ),
    );
    const h = renderApp('/admin/settings?section=sms', { user: admin });
    const sms = await card(s.sms.title);
    expect(within(sms).getByText(s.keepSecret)).toBeInTheDocument();
    await h.user.click(within(sms).getByRole('button', { name: s.save }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ accountSid: SID, authToken: '', from: '+15550001111' });
    await h.user.click(within(sms).getByRole('button', { name: s.remove }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('sends a test email and shows the provider reason when it fails', async () => {
    const api = mockApi(
      routes([
        {
          method: 'POST',
          path: '/admin/settings/email/test',
          body: (_c: unknown, n: number) => (n === 0 ? { status: 204 } : { status: 502, body: { error: { code: 'delivery_failed', message: '535 Auth failed' } } }),
        },
      ]),
    );
    const h = renderApp('/admin/settings?section=email', { user: admin });
    const email = await card(s.testTitle);
    await h.user.type(within(email).getByLabelText(s.testTo.email), 'ops@example.com');
    await h.user.click(within(email).getByRole('button', { name: s.sendTest }));
    expect(await within(email).findByText('Test sent to ops@example.com.')).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ to: 'ops@example.com' });
    await h.user.click(within(email).getByRole('button', { name: s.sendTest }));
    expect(await within(email).findByText('The provider refused the message: 535 Auth failed')).toBeInTheDocument();
  });

  it('warns and locks secret fields when the server has no encryption key', async () => {
    mockApi(routes([], settings({ secretsAvailable: false })));
    renderApp('/admin/settings?section=sms', { user: admin });
    expect(await screen.findByText(s.noKey)).toBeInTheDocument();
    expect(within(await card(s.sms.title)).getByLabelText(s.sms.authToken)).toBeDisabled();
  });
});

const g = s.general;
const BKASH = '01712345678';

describe('admin settings: General', () => {
  it('opens on General by default', async () => {
    mockApi(routes());
    const h = renderApp('/admin/settings', { user: admin });
    const panel = await screen.findByRole('tabpanel', { name: s.tab.general });
    expect(within(panel).getByRole('region', { name: g.signup.title })).toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: g.fee.title })).toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: g.payout.title })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: s.tab.general })).toHaveAttribute('aria-selected', 'true');
    expect(within(panel).getByRole('radio', { name: g.approval.manual })).toBeChecked();
    expect(h.location().search).toBe('');
    expect(within(panel).getByDisplayValue('http://localhost:4000/api/v1/webhooks/stripe/platform')).toBeInTheDocument();
  });

  it('free hides the amount fields', async () => {
    mockApi(routes());
    const h = renderApp('/admin/settings', { user: admin });
    const fee = await card(g.fee.title);
    expect(within(fee).getByRole('radio', { name: g.mode.free })).toBeChecked();
    expect(within(fee).queryByLabelText(g.fee.fixed)).not.toBeInTheDocument();
    expect(within(fee).queryByLabelText(g.fee.percent)).not.toBeInTheDocument();
    expect(within(fee).queryByText(/owner owes you/)).not.toBeInTheDocument();
    await h.user.click(within(fee).getByRole('radio', { name: g.mode.fixed }));
    expect(within(fee).getByLabelText(g.fee.fixed)).toBeInTheDocument();
    expect(within(fee).queryByLabelText(g.fee.percent)).not.toBeInTheDocument();
    await h.user.click(within(fee).getByRole('radio', { name: g.mode.free }));
    expect(within(fee).queryByLabelText(g.fee.fixed)).not.toBeInTheDocument();
  });

  it('percent shows the example for player payer', async () => {
    mockApi(routes());
    const h = renderApp('/admin/settings', { user: admin });
    const fee = await card(g.fee.title);
    await h.user.click(within(fee).getByRole('radio', { name: g.mode.percent }));
    await h.user.type(within(fee).getByLabelText(g.fee.percent), '5');
    expect(within(fee).getByText(/player pays .*1,000\.00, owner owes you .*50\.00/)).toBeInTheDocument();
    await h.user.click(within(fee).getByRole('radio', { name: g.payer.player }));
    expect(within(fee).getByText(/player pays .*1,050\.00/)).toBeInTheDocument();
  });

  it('saves general', async () => {
    const api = mockApi(routes([{ method: 'PUT', path: '/admin/settings/general', body: settings() }]));
    const h = renderApp('/admin/settings', { user: admin });
    const signup = await card(g.signup.title);
    await h.user.click(within(signup).getByRole('radio', { name: g.approval.automatic }));
    const fee = await card(g.fee.title);
    await h.user.click(within(fee).getByRole('radio', { name: g.mode.fixed }));
    await h.user.type(within(fee).getByLabelText(g.fee.fixed), '50');
    const payout = await card(g.payout.title);
    await h.user.click(within(payout).getByRole('checkbox', { name: 'bKash' }));
    await h.user.type(within(payout).getByLabelText(g.payout.number.bkash), BKASH);
    await h.user.click(screen.getByRole('button', { name: g.save }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(api.calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: '/admin/settings/general',
      body: {
        ownerApproval: 'automatic',
        fee: { mode: 'fixed', fixed: 50, percent: null, payer: 'owner' },
        payout: { bkash: { provider: 'bkash', number: BKASH, accountType: 'personal' }, nagad: null },
      },
    });
    expect(await screen.findByText(s.saved)).toBeInTheDocument();
  });

  it('checks the fee before sending', async () => {
    const api = mockApi(routes());
    const h = renderApp('/admin/settings', { user: admin });
    const fee = await card(g.fee.title);
    await h.user.click(within(fee).getByRole('radio', { name: g.mode.percent }));
    await h.user.type(within(fee).getByLabelText(g.fee.percent), '60');
    await h.user.click(screen.getByRole('button', { name: g.save }));
    expect(within(fee).getByText(g.errors.percent)).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('shows a field error from the server', async () => {
    mockApi(
      routes([
        {
          method: 'PUT',
          path: '/admin/settings/general',
          status: 400,
          body: {
            error: {
              code: 'validation_error',
              message: 'Invalid request',
              details: [{ code: 'custom', path: ['payout', 'bkash', 'number'], message: 'Use a Bangladesh mobile number, e.g. 01712345678' }],
            },
          },
        },
      ]),
    );
    const h = renderApp('/admin/settings', { user: admin });
    const payout = await card(g.payout.title);
    await h.user.click(within(payout).getByRole('checkbox', { name: 'bKash' }));
    await h.user.type(within(payout).getByLabelText(g.payout.number.bkash), '12345');
    await h.user.click(screen.getByRole('button', { name: g.save }));
    expect(await within(payout).findByText(g.errors.number)).toBeInTheDocument();
    expect(within(payout).getByLabelText(g.payout.number.bkash)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(en.errors.validation_error)).toBeInTheDocument();
  });

  it('saves payout Stripe keys on their own', async () => {
    const connected = settings({
      general: {
        ...settings().general,
        payout: { bkash: null, nagad: null, stripe: { mode: 'test', enabled: true, keys: { test: { publishableKey: 'pk_test_1', accountId: 'acct_1' }, live: null } } },
      },
    });
    const api = mockApi(routes([{ method: 'PUT', path: '/admin/settings/payout-stripe', body: connected }]));
    const h = renderApp('/admin/settings', { user: admin });
    const payout = await card(g.payout.title);
    await h.user.type(within(payout).getByLabelText(en.owner.gateway.secretKey), 'sk_test_abc');
    await h.user.type(within(payout).getByLabelText(en.owner.gateway.publishableKey), 'pk_test_1');
    await h.user.type(within(payout).getByLabelText(en.owner.gateway.webhookSecret), 'whsec_x');
    await h.user.click(within(payout).getByRole('button', { name: en.owner.gateway.save.test }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(api.calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: '/admin/settings/payout-stripe',
      body: { mode: 'test', secretKey: 'sk_test_abc', publishableKey: 'pk_test_1', webhookSecret: 'whsec_x', enabled: true },
    });
    expect(await within(payout).findByText('acct_1')).toBeInTheDocument();
    expect(within(payout).getByText(g.stripe.needKeys)).toBeInTheDocument();
    expect(within(payout).getByRole('button', { name: g.stripe.remove })).toBeInTheDocument();
  });

  it('locks the Stripe form when the server has no encryption key', async () => {
    mockApi(routes([], settings({ secretsAvailable: false })));
    renderApp('/admin/settings', { user: admin });
    const payout = await card(g.payout.title);
    expect(within(payout).getByLabelText(en.owner.gateway.secretKey)).toBeDisabled();
    expect(within(payout).getByRole('button', { name: en.owner.gateway.save.test })).toBeDisabled();
    expect(within(payout).getByText(g.stripe.noKey)).toBeInTheDocument();
  });
});
