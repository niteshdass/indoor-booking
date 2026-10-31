import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type {
  AdminOverviewJson,
  AdminOwnerDetailJson,
  AdminOwnerRowJson,
  AdminReviewJson,
  AdminUserJson,
  PlatformLogJson,
  PlatformPayoutJson,
} from '@booking/shared';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import type { PublicUser } from '../../src/lib/types';
import { mockApi, type Route } from '../helpers/api';
import { renderApp } from '../helpers/render';
import { ownerMembership, staffUser } from '../owner/fixtures';

const admin: PublicUser = { ...staffUser, id: 'u-admin', name: 'Ada Admin', platformAdmin: true };
const ME = { role: { key: 'super_admin', name: 'Super Admin' }, permissions: ['platform.view', 'platform.owners', 'platform.users', 'platform.reviews'] };

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

function ownerRow(over: Partial<AdminOwnerRowJson> = {}): AdminOwnerRowJson {
  return {
    id: 'o1',
    name: 'Arena One',
    country: 'BD',
    currency: 'BDT',
    status: 'pending_approval',
    createdAt: '2026-10-01T10:00:00.000Z',
    contact: { id: 'u1', name: 'Olga Owner', email: 'olga@example.com', phone: null },
    venues: 2,
    publishedVenues: 1,
    recentBookings: 5,
    ...over,
  };
}

function overview(over: Partial<AdminOverviewJson> = {}): AdminOverviewJson {
  return {
    owners: { active: 7, pending_approval: 1, suspended: 2 },
    users: { total: 120, recent: 9, previous: 4 },
    venues: { total: 10, published: 8 },
    bookings: { recent: 30, previous: 20 },
    earned: [{ currency: 'BDT', amount: 1_250_000 }],
    fees: { owed: [], collected: [] },
    openFlags: 3,
    pendingOwners: [ownerRow()],
    newestOwners: [ownerRow()],
    ...over,
  };
}

function detail(status: AdminOwnerDetailJson['owner']['status'] = 'pending_approval'): AdminOwnerDetailJson {
  return {
    owner: { id: 'o1', name: 'Arena One', country: 'BD', currency: 'BDT', locale: 'en', status, createdAt: '2026-10-01T10:00:00.000Z' },
    contacts: [{ id: 'u1', name: 'Olga Owner', email: 'olga@example.com', phone: null }],
    members: 3,
    venues: [{ id: 'v1', name: 'Main Hall', slug: 'main-hall', city: 'Dhaka', published: true, courts: 4, rating: { average: 4.5, count: 12 } }],
    recent: { bookings: 5, earned: [] },
    history: [],
  };
}

function payout(over: Partial<PlatformPayoutJson> = {}): PlatformPayoutJson {
  return {
    id: 'p1',
    ownerId: 'o1',
    ownerName: 'Arena One',
    currency: 'BDT',
    amount: 40_000,
    method: 'bkash',
    trxId: 'TRX12345',
    senderNumber: '01712345678',
    status: 'pending',
    rejectReason: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    reviewedAt: null,
    ...over,
  };
}

const adminRoutes = (extra: Route[] = []): Route[] => [
  { path: '/admin/me', body: ME },
  { path: '/admin/overview', body: overview() },
  ...extra,
];

describe('admin portal', () => {
  it('tells a non-admin the area is not for them', async () => {
    mockApi([{ path: '/admin/me', status: 403, body: { error: { code: 'forbidden', message: 'x' } } }]);
    renderApp('/admin', { user: staffUser });
    expect(await screen.findByText(en.admin.noAccess)).toBeInTheDocument();
  });

  it('overview shows the platform figures and who is waiting', async () => {
    mockApi(adminRoutes());
    renderApp('/admin', { user: admin });
    expect(await screen.findByText(en.admin.overview.businesses)).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    const pending = screen.getByRole('region', { name: en.admin.overview.pending });
    expect(within(pending).getByRole('link', { name: 'Arena One' })).toHaveAttribute('href', '/admin/owners/o1');
  });

  it('owners list sends the status tab and search to the server', async () => {
    const api = mockApi(
      adminRoutes([
        {
          path: '/admin/owners',
          body: { owners: [ownerRow()], total: 1, counts: { all: 10, active: 7, pending_approval: 1, suspended: 2 } },
        },
      ]),
    );
    const h = renderApp('/admin/owners', { user: admin });
    expect(await screen.findByRole('link', { name: 'Arena One' })).toBeInTheDocument();
    await h.user.click(screen.getByRole('tab', { name: /Pending approval/ }));
    await waitFor(() => expect(h.location().search).toBe('?status=pending_approval'));
    await h.user.type(screen.getByRole('searchbox', { name: en.admin.owners.search }), 'olga');
    await h.user.click(screen.getByRole('button', { name: en.admin.search }));
    await waitFor(() => {
      const last = api.calls.filter((c) => c.path === '/admin/owners').at(-1)!;
      expect(last.query.get('status')).toBe('pending_approval');
      expect(last.query.get('q')).toBe('olga');
    });
  });

  it('approves a waiting business', async () => {
    let status: AdminOwnerDetailJson['owner']['status'] = 'pending_approval';
    const api = mockApi(
      adminRoutes([
        { path: '/admin/owners/o1', body: () => detail(status) },
        {
          method: 'POST',
          path: '/admin/owners/o1/approve',
          body: () => {
            status = 'active';
            return { owner: { id: 'o1', status } };
          },
        },
      ]),
    );
    const h = renderApp('/admin/owners/o1', { user: admin });
    await h.user.click(await screen.findByRole('button', { name: en.admin.owner.approve }));
    const dialog = await screen.findByRole('dialog');
    await h.user.click(within(dialog).getByRole('button', { name: en.admin.owner.approve }));
    expect(await screen.findByRole('button', { name: en.admin.owner.suspend })).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/admin/owners/o1/approve')).toBe(true);
  });

  it('suspending needs a reason, which is sent', async () => {
    const api = mockApi(
      adminRoutes([
        { path: '/admin/owners/o1', body: detail('active') },
        { method: 'POST', path: '/admin/owners/o1/suspend', body: { owner: { id: 'o1', status: 'suspended' } } },
      ]),
    );
    const h = renderApp('/admin/owners/o1', { user: admin });
    await h.user.click(await screen.findByRole('button', { name: en.admin.owner.suspend }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: en.admin.owner.suspend });
    expect(confirm).toBeDisabled();
    await h.user.type(within(dialog).getByRole('textbox', { name: new RegExp(en.admin.reason) }), 'Fake venue');
    await h.user.click(confirm);
    await waitFor(() =>
      expect(api.calls.find((c) => c.path === '/admin/owners/o1/suspend')?.body).toEqual({ reason: 'Fake venue' }),
    );
  });

  it('disables a user but offers no action on another admin', async () => {
    const users: AdminUserJson[] = [
      { id: 'u2', name: 'Pat Player', email: 'pat@example.com', phone: null, status: 'active', platformAdmin: false, teams: 0, createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'u3', name: 'Other Admin', email: 'oa@example.com', phone: null, status: 'active', platformAdmin: true, teams: 0, createdAt: '2026-09-01T00:00:00.000Z' },
    ];
    const api = mockApi(
      adminRoutes([
        { path: '/admin/users', body: { users, total: 2 } },
        { method: 'POST', path: '/admin/users/u2/disable', body: { user: { id: 'u2', status: 'disabled' } } },
      ]),
    );
    const h = renderApp('/admin/users', { user: admin });
    expect(await screen.findByText('Pat Player')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: en.admin.users.disable })).toHaveLength(1);
    await h.user.click(screen.getByRole('button', { name: en.admin.users.disable }));
    const dialog = await screen.findByRole('dialog');
    await h.user.click(within(dialog).getByRole('button', { name: en.admin.users.disable }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'POST' && c.path === '/admin/users/u2/disable')).toBe(true));
  });

  it('hides a flagged review and drops its actions', async () => {
    const review: AdminReviewJson = {
      id: 'r1',
      stars: 1,
      comment: 'Terrible',
      createdAt: '2026-10-20T00:00:00.000Z',
      author: 'Pat Player',
      venue: { id: 'v1', name: 'Main Hall', slug: 'main-hall' },
      owner: { id: 'o1', name: 'Arena One' },
      flag: { at: '2026-10-21T00:00:00.000Z', reason: 'Abusive', by: 'Olga Owner' },
      reply: null,
      state: 'flagged',
    };
    mockApi(
      adminRoutes([
        { path: '/admin/reviews', body: { reviews: [review], nextBefore: null } },
        { method: 'POST', path: '/admin/reviews/r1/hide', body: { review: { ...review, state: 'hidden' } } },
      ]),
    );
    const h = renderApp('/admin/reviews', { user: admin });
    expect(await screen.findByText('Terrible')).toBeInTheDocument();
    await h.user.click(screen.getByRole('button', { name: en.admin.reviews.hide }));
    const dialog = await screen.findByRole('dialog');
    await h.user.click(within(dialog).getByRole('button', { name: en.admin.reviews.hide }));
    await waitFor(() => expect(screen.queryByRole('button', { name: en.admin.reviews.hide })).not.toBeInTheDocument());
    expect(within(screen.getByRole('article')).getByText(en.admin.reviews.state.hidden)).toBeInTheDocument();
  });

  it('activity labels each entry and links it to the business', async () => {
    const entry: PlatformLogJson = {
      id: 'l1',
      action: 'owner.suspended',
      actor: { id: 'u-admin', name: 'Ada Admin' },
      entity: 'owner',
      entityId: 'o1',
      target: 'Arena One',
      ownerId: 'o1',
      reason: 'Fake venue',
      at: '2026-10-21T00:00:00.000Z',
    };
    mockApi(adminRoutes([{ path: '/admin/activity', body: { entries: [entry], nextBefore: null } }]));
    renderApp('/admin/activity', { user: admin });
    expect(await screen.findByRole('link', { name: 'Suspended Arena One' })).toHaveAttribute('href', '/admin/owners/o1');
    expect(screen.getByText('Fake venue')).toBeInTheDocument();
  });
});

describe('admin payouts and balances', () => {
  it('lists pending payouts and confirms one', async () => {
    const api = mockApi(
      adminRoutes([
        { path: '/admin/payouts', body: { payouts: [payout()], nextBefore: null } },
        { method: 'POST', path: '/admin/payouts/p1/confirm', body: { payout: payout({ status: 'confirmed', reviewedAt: '2026-10-21T00:00:00.000Z' }) } },
      ]),
    );
    const h = renderApp('/admin/payouts', { user: admin });
    expect(await screen.findByText('TRX12345')).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === '/admin/payouts')?.query.get('status')).toBe('pending');
    await h.user.click(screen.getByRole('button', { name: en.admin.payouts.confirm }));
    const dialog = await screen.findByRole('dialog');
    await h.user.click(within(dialog).getByRole('button', { name: en.admin.payouts.confirm }));
    await waitFor(() => expect(screen.queryByText('TRX12345')).not.toBeInTheDocument());
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/admin/payouts/p1/confirm')).toBe(true);
    expect(screen.getByText(en.admin.payouts.empty.pending)).toBeInTheDocument();
  });

  it('reject needs a reason', async () => {
    const api = mockApi(
      adminRoutes([
        { path: '/admin/payouts', body: { payouts: [payout()], nextBefore: null } },
        { method: 'POST', path: '/admin/payouts/p1/reject', body: { payout: payout({ status: 'rejected', rejectReason: 'No such transfer' }) } },
      ]),
    );
    const h = renderApp('/admin/payouts', { user: admin });
    await h.user.click(await screen.findByRole('button', { name: en.admin.payouts.reject }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: en.admin.payouts.reject });
    expect(confirm).toBeDisabled();
    await h.user.type(within(dialog).getByRole('textbox', { name: new RegExp(en.admin.reason) }), 'No such transfer');
    await h.user.click(confirm);
    await waitFor(() => expect(api.calls.find((c) => c.path === '/admin/payouts/p1/reject')?.body).toEqual({ reason: 'No such transfer' }));
  });

  it('shows a friendly error when the payout was already reviewed', async () => {
    mockApi(
      adminRoutes([
        { path: '/admin/payouts', body: { payouts: [payout()], nextBefore: null } },
        { method: 'POST', path: '/admin/payouts/p1/confirm', status: 409, body: { error: { code: 'payout_not_pending', message: 'x' } } },
      ]),
    );
    const h = renderApp('/admin/payouts', { user: admin });
    await h.user.click(await screen.findByRole('button', { name: en.admin.payouts.confirm }));
    const dialog = await screen.findByRole('dialog');
    await h.user.click(within(dialog).getByRole('button', { name: en.admin.payouts.confirm }));
    expect(await within(dialog).findByText(en.errors.payout_not_pending)).toBeInTheDocument();
  });

  it('history labels stale card payouts and offers no actions on them', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T12:00:00.000Z') });
    try {
      const api = mockApi(
        adminRoutes([
          {
            path: '/admin/payouts',
            body: {
              payouts: [
                payout({ id: 'p2', method: 'stripe', trxId: null, senderNumber: null, createdAt: '2026-10-20T10:00:00.000Z' }),
                payout({ id: 'p3', status: 'rejected', trxId: 'OLDTRX99', rejectReason: 'Wrong amount' }),
              ],
              nextBefore: null,
            },
          },
        ]),
      );
      renderApp('/admin/payouts?status=all', { user: admin });
      expect(await screen.findByText(en.admin.payouts.status.stale)).toBeInTheDocument();
      expect(api.calls.find((c) => c.path === '/admin/payouts')?.query.get('status')).toBe('all');
      expect(screen.getByText('OLDTRX99')).toBeInTheDocument();
      expect(screen.getByText('Wrong amount')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: en.admin.payouts.confirm })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('owners list shows owes and credit', async () => {
    mockApi(
      adminRoutes([
        {
          path: '/admin/owners',
          body: {
            owners: [ownerRow({ owes: [{ currency: 'BDT', amount: 4000 }] }), ownerRow({ id: 'o2', name: 'Arena Two', owes: [{ currency: 'BDT', amount: -5000 }] }), ownerRow({ id: 'o3', name: 'Arena Three', owes: [] })],
            total: 3,
            counts: { all: 3, active: 0, pending_approval: 3, suspended: 0 },
          },
        },
      ]),
    );
    renderApp('/admin/owners', { user: admin });
    expect(await screen.findByRole('columnheader', { name: en.admin.owners.col.owes })).toBeInTheDocument();
    expect(screen.getByText(/^(৳|BDT\s)40\.00$/)).toBeInTheDocument();
    expect(screen.getByText(/^Credit (৳|BDT\s)50\.00$/)).toBeInTheDocument();
    expect(screen.queryByText(/[-−](৳|BDT)/)).not.toBeInTheDocument();
  });

  it('hides payouts and the Owes column without platform.owners', async () => {
    mockApi([
      { path: '/admin/me', body: { ...ME, permissions: ['platform.view'] } },
      { path: '/admin/overview', body: overview() },
      { path: '/admin/owners', body: { owners: [ownerRow()], total: 1, counts: { all: 1, active: 0, pending_approval: 1, suspended: 0 } } },
    ]);
    renderApp('/admin/owners', { user: admin });
    expect(await screen.findByRole('link', { name: 'Arena One' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: en.admin.owners.col.owes })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: en.admin.nav.payouts })).not.toBeInTheDocument();
  });

  it('overview shows fees only when there are any', async () => {
    mockApi([
      { path: '/admin/me', body: ME },
      { path: '/admin/overview', body: overview({ fees: { owed: [{ currency: 'BDT', amount: 12_000 }], collected: [] } }) },
    ]);
    renderApp('/admin', { user: admin });
    const fees = await screen.findByRole('region', { name: new RegExp(en.admin.overview.fees.title.replace('{{days}}', '30')) });
    expect(within(fees).getByText(en.admin.overview.fees.owed)).toBeInTheDocument();
    expect(within(fees).getByText(/(৳|BDT\s)120\.00/)).toBeInTheDocument();
  });

  it('overview has no fee block in free mode', async () => {
    mockApi(adminRoutes());
    renderApp('/admin', { user: admin });
    expect(await screen.findByText(en.admin.overview.businesses)).toBeInTheDocument();
    expect(screen.queryByText(en.admin.overview.fees.owed)).not.toBeInTheDocument();
  });
});

describe('list your venue', () => {
  it('sends the application and goes to the owner page', async () => {
    const api = mockApi([
      { method: 'POST', path: '/owners', status: 201, body: { owner: { id: 'o9', name: 'New Club', status: 'pending_approval' } } },
      {
        path: '/me/memberships',
        body: { memberships: [ownerMembership({ ownerId: 'o9', ownerName: 'New Club', ownerStatus: 'pending_approval' })] },
      },
    ]);
    const h = renderApp('/list-your-venue', { user: staffUser });
    await h.user.type(await screen.findByRole('textbox', { name: new RegExp(en.apply.name) }), 'New Club');
    await h.user.selectOptions(screen.getByRole('combobox', { name: new RegExp(en.apply.country) }), 'BD');
    await h.user.selectOptions(screen.getByRole('combobox', { name: new RegExp(en.apply.currency) }), 'BDT');
    await h.user.click(screen.getByRole('button', { name: en.apply.submit }));
    await waitFor(() => expect(h.location().pathname).toBe('/owner'));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'New Club', country: 'BD', currency: 'BDT', locale: 'en' });
    expect(await screen.findByText(en.owner.pendingNote)).toBeInTheDocument();
  });

  it('shows the live notice when the application is approved at once', async () => {
    mockApi([
      { method: 'POST', path: '/owners', status: 201, body: { owner: { id: 'o9', name: 'New Club', status: 'active' } } },
      { path: '/me/memberships', body: { memberships: [ownerMembership({ ownerId: 'o1', ownerName: 'Old Club', ownerStatus: 'active' }), ownerMembership({ ownerId: 'o9', ownerName: 'New Club', ownerStatus: 'active' })] } },
    ]);
    const h = renderApp('/list-your-venue', { user: staffUser });
    await h.user.type(await screen.findByRole('textbox', { name: new RegExp(en.apply.name) }), 'New Club');
    await h.user.selectOptions(screen.getByRole('combobox', { name: new RegExp(en.apply.country) }), 'BD');
    await h.user.selectOptions(screen.getByRole('combobox', { name: new RegExp(en.apply.currency) }), 'BDT');
    await h.user.click(screen.getByRole('button', { name: en.apply.submit }));
    expect(await screen.findByText(en.apply.live)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.apply.goToDashboard })).toHaveAttribute('href', '/owner/o9');
  });

  it('says so when an application is already waiting', async () => {
    mockApi([{ method: 'POST', path: '/owners', status: 409, body: { error: { code: 'application_pending', message: 'x' } } }]);
    const h = renderApp('/list-your-venue', { user: staffUser });
    await h.user.type(await screen.findByRole('textbox', { name: new RegExp(en.apply.name) }), 'New Club');
    await h.user.selectOptions(screen.getByRole('combobox', { name: new RegExp(en.apply.country) }), 'BD');
    await h.user.selectOptions(screen.getByRole('combobox', { name: new RegExp(en.apply.currency) }), 'BDT');
    await h.user.click(screen.getByRole('button', { name: en.apply.submit }));
    expect(await screen.findByText(en.errors.application_pending)).toBeInTheDocument();
  });

  it('profile links a platform admin to the admin portal', async () => {
    mockApi([{ path: '/me/memberships', body: { memberships: [] } }]);
    renderApp('/profile', { user: admin });
    expect(await screen.findByRole('link', { name: new RegExp(en.profile.adminPortal) })).toHaveAttribute('href', '/admin');
  });
});
