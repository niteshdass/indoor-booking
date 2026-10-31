import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { OwnerPlatformFeeJson, PlatformBalanceJson, PlatformPayoutJson } from '@booking/shared';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { money } from '../../src/lib/format';
import { mockApi, type Route } from '../helpers/api';
import { renderApp } from '../helpers/render';
import { OWNER_ID, ownerRoutes, staffUser } from './fixtures';

const h = vi.hoisted(() => ({ loadStripe: vi.fn(), confirmPayment: vi.fn(), options: [] as unknown[] }));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: h.loadStripe }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children, options }: { children: ReactNode; options: unknown }) => {
    h.options.push(options);
    return <>{children}</>;
  },
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment: h.confirmPayment }),
  useElements: () => ({}),
}));

const PAGE = `/owner/${OWNER_ID}/platform-fee`;
const FEE_PATH = `/owners/${OWNER_ID}/platform-fee`;
// Testing Library collapses the no-break space money() puts after the code, so match on a plain space.
const bdt = (minor: number) => money(minor, 'BDT', 'en').replace(/\s/gu, ' ');

function balance(over: Partial<PlatformBalanceJson> = {}): PlatformBalanceJson {
  return { currency: 'BDT', owed: 5000, paid: 0, pending: 1000, balance: 5000, payable: 4000, ...over };
}

function payout(over: Partial<PlatformPayoutJson> = {}): PlatformPayoutJson {
  return {
    id: 'p1',
    ownerId: OWNER_ID,
    currency: 'BDT',
    amount: 1000,
    method: 'bkash',
    trxId: 'TRX0000001',
    senderNumber: '+8801711111111',
    status: 'pending',
    rejectReason: null,
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    ...over,
  };
}

const BKASH = { provider: 'bkash' as const, number: '+8801812345678', accountType: 'personal' as const };

function fee(over: Partial<OwnerPlatformFeeJson> = {}): OwnerPlatformFeeJson {
  return {
    feeActive: true,
    payer: 'owner',
    balances: [balance()],
    payouts: [],
    methods: { bkash: BKASH, nagad: null, stripe: null },
    ...over,
  };
}

function api(data: OwnerPlatformFeeJson, extra: Route[] = [], permissions: NonNullable<Parameters<typeof ownerRoutes>[0]>['permissions'] = ['settings.edit']) {
  return mockApi([...ownerRoutes({ permissions }), { method: 'GET', path: FEE_PATH, body: data }, ...extra]);
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  h.loadStripe.mockReset().mockResolvedValue({});
  h.confirmPayment.mockReset().mockResolvedValue({});
  h.options.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const nav = () => screen.findByRole('navigation', { name: en.owner.nav.label });
const openDialog = async (user: ReturnType<typeof renderApp>['user']) => {
  await user.click(await screen.findByRole('button', { name: en.owner.platformFee.payNow }));
  return screen.findByRole('dialog', { name: en.owner.platformFee.dialog.title });
};

describe('owner platform fee page', () => {
  it('shows balance and pending', async () => {
    api(fee());
    renderApp(PAGE, { user: staffUser });
    expect(await screen.findByText(i18n.t('owner.platformFee.owe', { amount: bdt(5000) }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('owner.platformFee.pending', { pending: bdt(1000) }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.owner.platformFee.payNow })).toBeInTheDocument();
    expect(screen.getByText(en.owner.platformFee.intro.owner)).toBeInTheDocument();
  });

  it('shows credit with no pay action', async () => {
    api(fee({ balances: [balance({ owed: 1000, paid: 3000, pending: 0, balance: -2000, payable: 0 })] }));
    renderApp(PAGE, { user: staffUser });
    expect(await screen.findByText(i18n.t('owner.platformFee.credit', { amount: bdt(2000) }))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.owner.platformFee.payNow })).toBeNull();
    expect(screen.queryByText(/You owe/)).toBeNull();
  });

  it('history shows status badges, the rejected TrxID and reason, and stale card payouts as not completed', async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    api(
      fee({
        payouts: [
          payout({ id: 'a', status: 'rejected', trxId: 'REJ1234567', rejectReason: 'Not in our wallet' }),
          payout({ id: 'b', status: 'confirmed', trxId: 'OK12345678' }),
          payout({ id: 'c', method: 'stripe', trxId: null, senderNumber: null, createdAt: old }),
          payout({ id: 'd', method: 'stripe', trxId: null, senderNumber: null, status: 'rejected', rejectReason: 'stripe_failed' }),
        ],
      }),
    );
    renderApp(PAGE, { user: staffUser });
    const table = await screen.findByRole('table', { name: en.owner.platformFee.history });
    expect(within(table).getByText('REJ1234567')).toBeInTheDocument();
    expect(within(table).getByText('Not in our wallet')).toBeInTheDocument();
    expect(within(table).getByText(en.admin.payouts.status.confirmed)).toBeInTheDocument();
    expect(within(table).getByText(en.admin.payouts.status.stale)).toBeInTheDocument();
    expect(within(table).getByText(en.owner.platformFee.stripeFailed)).toBeInTheDocument();
  });

  it('hides methods the admin has not set', async () => {
    api(fee({ methods: { bkash: null, nagad: { provider: 'nagad', number: '+8801912345678', accountType: 'merchant' }, stripe: null } }));
    const { user } = renderApp(PAGE, { user: staffUser });
    const dialog = await openDialog(user);
    expect(within(dialog).queryByRole('radio', { name: /bKash/ })).toBeNull();
    expect(within(dialog).queryByRole('radio', { name: /Card/ })).toBeNull();
    expect(within(dialog).getByRole('radio', { name: /Nagad/ })).toBeChecked();
    expect(within(dialog).getByText('+880 1912-345678')).toBeInTheDocument();
  });

  it('manual payout submits trx and sender', async () => {
    const { calls } = api(fee(), [{ method: 'POST', path: `/owners/${OWNER_ID}/platform-payouts`, status: 201, body: payout() }]);
    const { user } = renderApp(PAGE, { user: staffUser });
    const dialog = await openDialog(user);
    expect((within(dialog).getByLabelText(en.owner.platformFee.dialog.amount) as HTMLInputElement).value).toBe('40.00');
    await user.type(within(dialog).getByLabelText(en.payment.wallet.trxId), 'abc12345xy');
    await user.type(within(dialog).getByLabelText(en.payment.wallet.sender), '01711111111');
    await user.click(within(dialog).getByRole('button', { name: en.owner.platformFee.dialog.submitManual }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe(`/owners/${OWNER_ID}/platform-payouts`);
    expect(post.body).toEqual({ currency: 'BDT', amount: 4000, method: 'bkash', trxId: 'ABC12345XY', senderNumber: '01711111111' });
    expect(await within(dialog).findByText(en.owner.platformFee.dialog.sent)).toBeInTheDocument();
    // The balances are fetched again.
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.path === FEE_PATH).length).toBeGreaterThanOrEqual(3));
  });

  it('amount over payable is blocked', async () => {
    const { calls } = api(fee(), [
      {
        method: 'POST',
        path: `/owners/${OWNER_ID}/platform-payouts`,
        status: 400,
        body: { error: { code: 'amount_exceeds_balance', message: 'x' } },
      },
    ]);
    const { user } = renderApp(PAGE, { user: staffUser });
    const dialog = await openDialog(user);
    const amount = within(dialog).getByLabelText(en.owner.platformFee.dialog.amount);
    await user.clear(amount);
    await user.type(amount, '41');
    await user.type(within(dialog).getByLabelText(en.payment.wallet.trxId), 'ABC12345XY');
    await user.type(within(dialog).getByLabelText(en.payment.wallet.sender), '01711111111');
    const submit = within(dialog).getByRole('button', { name: en.owner.platformFee.dialog.submitManual });
    await user.click(submit);
    expect(await within(dialog).findByText(i18n.t('owner.platformFee.dialog.amountOver', { max: bdt(4000) }))).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    // The balance changed since the page loaded: the server says so too.
    await user.clear(amount);
    await user.type(amount, '40');
    await user.click(submit);
    expect(await within(dialog).findByText(en.errors.amount_exceeds_balance)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('duplicate TrxID shows under the TrxID field', async () => {
    api(fee(), [
      { method: 'POST', path: `/owners/${OWNER_ID}/platform-payouts`, status: 409, body: { error: { code: 'duplicate_trx', message: 'x' } } },
    ]);
    const { user } = renderApp(PAGE, { user: staffUser });
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText(en.payment.wallet.trxId), 'ABC12345XY');
    await user.type(within(dialog).getByLabelText(en.payment.wallet.sender), '01711111111');
    await user.click(within(dialog).getByRole('button', { name: en.owner.platformFee.dialog.submitManual }));
    const field = within(dialog).getByLabelText(en.payment.wallet.trxId);
    await waitFor(() => expect(field).toHaveAccessibleDescription(expect.stringContaining(en.errors.duplicate_trx)));
  });

  it('card payout confirms with Stripe and says it shows as paid in a moment', async () => {
    const { calls } = api(fee({ methods: { bkash: null, nagad: null, stripe: { publishableKey: 'pk_admin' } } }), [
      {
        method: 'POST',
        path: `/owners/${OWNER_ID}/platform-payouts/stripe`,
        status: 201,
        body: { payout: payout({ method: 'stripe', trxId: null, amount: 4000 }), clientSecret: 'cs_admin', publishableKey: 'pk_admin' },
      },
    ]);
    const { user } = renderApp(PAGE, { user: staffUser });
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: en.owner.platformFee.dialog.toCard }));
    expect(await within(dialog).findByTestId('payment-element')).toBeInTheDocument();
    expect(h.loadStripe).toHaveBeenCalledWith('pk_admin');
    expect((h.options.at(-1) as { clientSecret: string }).clientSecret).toBe('cs_admin');
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ currency: 'BDT', amount: 4000 });
    await user.click(within(dialog).getByRole('button', { name: i18n.t('owner.platformFee.dialog.payCard', { amount: money(4000, 'BDT', 'en') }) }));
    expect(await within(dialog).findByText(en.owner.platformFee.dialog.received)).toBeInTheDocument();
    expect(h.confirmPayment.mock.calls[0]![0].redirect).toBe('if_required');
  });
});

describe('platform fee nav item', () => {
  it('nav item hidden in free mode with no balance', async () => {
    const { calls } = api(fee({ feeActive: false, balances: [balance({ owed: 0, pending: 0, balance: 0, payable: 0 })] }));
    renderApp(`/owner/${OWNER_ID}/settings`, { user: staffUser });
    await nav();
    await waitFor(() => expect(calls.some((c) => c.path === FEE_PATH)).toBe(true));
    // Let the response land before checking it stayed hidden.
    await screen.findByRole('link', { name: en.owner.nav.settings });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('link', { name: en.owner.nav.platformFee })).toBeNull();
  });

  it('nav item shown in free mode while a credit is left', async () => {
    api(fee({ feeActive: false, balances: [balance({ owed: 0, paid: 500, pending: 0, balance: -500, payable: 0 })] }));
    renderApp(`/owner/${OWNER_ID}/settings`, { user: staffUser });
    expect(await screen.findByRole('link', { name: en.owner.nav.platformFee })).toHaveAttribute('href', PAGE);
  });

  it('nav item shown when the fee is on', async () => {
    api(fee({ balances: [] }));
    renderApp(`/owner/${OWNER_ID}/settings`, { user: staffUser });
    expect(await screen.findByRole('link', { name: en.owner.nav.platformFee })).toBeInTheDocument();
  });

  it('members without settings.edit never load or see it', async () => {
    const { calls } = api(fee(), [], ['booking.view']);
    renderApp(`/owner/${OWNER_ID}/bookings`, { user: staffUser });
    await nav();
    expect(screen.queryByRole('link', { name: en.owner.nav.platformFee })).toBeNull();
    expect(calls.some((c) => c.path === FEE_PATH)).toBe(false);
  });

  it('free mode with nothing owed shows no fee page', async () => {
    api(fee({ feeActive: false, balances: [], payouts: [] }));
    const { location } = renderApp(PAGE, { user: staffUser });
    await waitFor(() => expect(location().pathname).not.toBe(PAGE));
    expect(screen.queryByText(/You owe/)).toBeNull();
  });
});
