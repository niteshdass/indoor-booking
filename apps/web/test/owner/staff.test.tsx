import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { PERMISSIONS } from '@booking/shared';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import { mockApi } from '../helpers/api';
import { OWNER_ID, member, ownerRoutes, role, staffUser } from './fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const S = en.owner.staff;
const URL = `/owner/${OWNER_ID}/staff`;
// The caller (membership m1) holds only these, so every other permission is out of reach.
const CALLER = ['booking.view', 'staff.manage'] as const;

const ROLES = [
  role({ id: 'r-owner', key: 'owner', name: 'Owner', permissions: [...PERMISSIONS], memberCount: 1 }),
  role({ id: 'r-manager', key: 'manager', name: 'Manager', permissions: ['booking.view'], memberCount: 2 }),
  role({ id: 'r-desk', key: null, name: 'Front desk', system: false, permissions: ['booking.view'], memberCount: 0 }),
  role({ id: 'r-used', key: null, name: 'Cashiers', system: false, permissions: ['booking.view'], memberCount: 3 }),
];
const rolesRoute = { path: '/owners/o1/roles', body: { roles: ROLES } };
const membersRoute = (members = [member()]) => ({ path: '/owners/o1/members', body: { members } });
const permPath = (key: string) => key.replace('.', '_') as keyof typeof en.owner.perm;

describe('roles', () => {
  it('role editor lists every permission once and disables ones the caller lacks', async () => {
    mockApi([rolesRoute, membersRoute(), ...ownerRoutes({ permissions: [...CALLER] })]);
    const { user } = renderApp(`${URL}?tab=roles`, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: S.roleAdd }));
    const dialog = await screen.findByRole('dialog');
    for (const p of PERMISSIONS) {
      const box = within(dialog).getAllByLabelText(en.owner.perm[permPath(p)]);
      expect(box).toHaveLength(1);
      expect((box[0] as HTMLInputElement).disabled).toBe(!(CALLER as readonly string[]).includes(p));
    }
    expect(within(dialog).getAllByText(S.cannotGrant)).toHaveLength(PERMISSIONS.length - CALLER.length);
  });

  it('creates a role with the checked permissions', async () => {
    const { calls } = mockApi([
      { method: 'POST', path: '/owners/o1/roles', status: 201, body: { role: ROLES[2] } },
      rolesRoute,
      membersRoute(),
      ...ownerRoutes({ permissions: [...CALLER] }),
    ]);
    const { user } = renderApp(`${URL}?tab=roles`, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: S.roleAdd }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(S.field.roleName), 'Night desk');
    await user.click(within(dialog).getByLabelText(en.owner.perm.booking_view));
    await user.click(within(dialog).getByRole('button', { name: S.save }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Night desk', permissions: ['booking.view'] });
  });

  it('system role names are translated, custom names are shown as typed', async () => {
    await i18n.changeLanguage('ru');
    mockApi([rolesRoute, membersRoute(), ...ownerRoutes({ permissions: [...CALLER] })]);
    renderApp(`${URL}?tab=roles`, { user: staffUser });
    const table = await screen.findByRole('table', { name: ru.owner.staff.tab.roles });
    expect(within(table).getByText(ru.owner.roleName.owner)).toBeInTheDocument();
    expect(within(table).getByText(ru.owner.roleName.manager)).toBeInTheDocument();
    expect(within(table).queryByText('Owner')).toBeNull();
    expect(within(table).getByText('Front desk')).toBeInTheDocument();
  });

  it('system role is read-only and in-use role cannot be deleted', async () => {
    mockApi([rolesRoute, membersRoute(), ...ownerRoutes({ permissions: [...CALLER] })]);
    const { user } = renderApp(`${URL}?tab=roles`, { user: staffUser });
    const table = within(await screen.findByRole('table'));
    const manager = table.getByText('Manager').closest('tr')!;
    expect(within(manager).getByText(S.system)).toBeTruthy();
    expect(within(manager).queryByRole('button', { name: S.delete })).toBeNull();
    expect(within(manager).queryByRole('button', { name: S.edit })).toBeNull();
    await user.click(within(manager).getByRole('button', { name: S.view }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText(en.owner.perm.booking_view) as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog).queryByRole('button', { name: S.save })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: S.cancel }));

    const used = table.getByText('Cashiers').closest('tr')!;
    expect((within(used).getByRole('button', { name: S.delete }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(used).getByText(en.errors.role_in_use)).toBeTruthy();
    const free = table.getByText('Front desk').closest('tr')!;
    expect((within(free).getByRole('button', { name: S.delete }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('members', () => {
  const SELF = member({ id: 'm1', user: { id: 'u1', name: 'Sam Staff', email: 'sam@example.com', phone: null } });
  const OWNER = member({ id: 'm9', user: { id: 'u9', name: 'Olga Owner', email: 'olga@example.com', phone: null }, role: { id: 'r-owner', key: 'owner', name: 'Owner' } });
  const MIA = member({ id: 'm2', user: { id: 'u2', name: 'Mia Manager', email: null, phone: '+8801712345678' } });

  it('own row and owner row have no edit or remove', async () => {
    mockApi([rolesRoute, membersRoute([SELF, OWNER, MIA]), ...ownerRoutes({ permissions: [...CALLER] })]);
    renderApp(URL, { user: staffUser });
    const table = within(await screen.findByRole('table'));
    const mia = table.getByText('Mia Manager').closest('tr')!;
    expect(within(mia).getByRole('button', { name: S.edit })).toBeTruthy();
    expect(within(mia).getByRole('button', { name: S.remove })).toBeTruthy();
    expect(within(mia).getByText('+8801712345678')).toBeTruthy();
    for (const name of ['Sam Staff', 'Olga Owner']) {
      const row = table.getByText(name).closest('tr')!;
      expect(within(row).queryByRole('button', { name: S.edit })).toBeNull();
      expect(within(row).queryByRole('button', { name: S.remove })).toBeNull();
    }
    expect(within(mia).getByText(S.allVenues)).toBeTruthy();
    expect(within(mia).getByText(S.status.active)).toBeTruthy();
  });

  it('add member posts phone contact and selected venues', async () => {
    const { calls } = mockApi([
      { method: 'POST', path: '/owners/o1/members', status: 201, body: { member: MIA } },
      rolesRoute,
      membersRoute([SELF]),
      ...ownerRoutes({ permissions: [...CALLER] }),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: S.memberAdd }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(S.noInvite)).toBeTruthy();
    // The owner role is never offered.
    expect(within(dialog).queryByRole('option', { name: 'Owner' })).toBeNull();
    await user.type(within(dialog).getByLabelText(S.field.name), 'Mia Manager');
    await user.selectOptions(within(dialog).getByLabelText(S.field.contactType), 'phone');
    await user.type(within(dialog).getByLabelText(en.auth.phone.number), '1712345678');
    await user.selectOptions(within(dialog).getByLabelText(S.field.role), 'r-desk');
    await user.click(within(dialog).getByLabelText(S.field.allVenues));
    await user.click(within(dialog).getByLabelText('Arena One'));
    await user.click(within(dialog).getByRole('button', { name: S.save }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Mia Manager',
      phone: '+8801712345678',
      roleId: 'r-desk',
      venueIds: ['v1'],
    });
  });

  it('edit member patches only changed keys', async () => {
    const { calls } = mockApi([
      { method: 'PATCH', path: '/owners/o1/members/m2', body: { member: { ...MIA, status: 'disabled' } } },
      rolesRoute,
      membersRoute([SELF, MIA]),
      ...ownerRoutes({ permissions: [...CALLER] }),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    const row = (await screen.findByText('Mia Manager')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: S.edit }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(S.field.status), 'disabled');
    await user.click(within(dialog).getByRole('button', { name: S.save }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'disabled' });
  });

  it('remove asks for confirmation then deletes', async () => {
    const { calls } = mockApi([
      { method: 'DELETE', path: '/owners/o1/members/m2', status: 204, body: undefined },
      rolesRoute,
      membersRoute([SELF, MIA]),
      ...ownerRoutes({ permissions: [...CALLER] }),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    const row = (await screen.findByText('Mia Manager')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: S.remove }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(await screen.findByRole('button', { name: S.removeConfirm }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('privilege_escalation is shown translated', async () => {
    mockApi([
      { method: 'POST', path: '/owners/o1/members', status: 403, body: { error: { code: 'privilege_escalation', message: 'x' } } },
      rolesRoute,
      membersRoute([SELF]),
      ...ownerRoutes({ permissions: [...CALLER] }),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    await user.click(await screen.findByRole('button', { name: S.memberAdd }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(S.field.name), 'New Person');
    await user.type(within(dialog).getByLabelText(S.field.email), 'new@example.com');
    await user.click(within(dialog).getByRole('button', { name: S.save }));
    expect(await within(dialog).findByText(en.errors.privilege_escalation)).toBeTruthy();
  });
});
