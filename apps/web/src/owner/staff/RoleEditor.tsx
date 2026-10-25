import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Permission } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Dialog } from '../../components/ui/Dialog';
import { Table } from '../../components/ui/Table';
import { TextField } from '../../components/ui/TextField';
import { apiDelete, apiPatch, apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { roleLabel } from '../roleLabel';
import { ConfirmDeleteDialog } from '../schedule/ConfirmDeleteDialog';
import type { Role } from '../types';
import styles from './staff.module.css';

const NAME_MAX = 50;
const GROUPS: { id: 'bookings' | 'venues' | 'admin'; perms: Permission[] }[] = [
  {
    id: 'bookings',
    perms: ['booking.view', 'booking.create', 'booking.confirm', 'booking.cancel', 'booking.checkin', 'payment.mark_cash', 'refund.issue'],
  },
  { id: 'venues', perms: ['venue.manage', 'turf.manage', 'pricing.edit', 'slot.override', 'addon.manage'] },
  { id: 'admin', perms: ['staff.manage', 'settings.edit', 'reports.view'] },
];
const permLabel = (p: Permission) => `owner.perm.${p.replace('.', '_')}`;

type Props = { roles: Role[]; onChanged(): void };

/** The roles list with create, edit/view and delete. System roles are read-only. */
export function RoleEditor({ roles, onChanged }: Props) {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [removing, setRemoving] = useState<Role | null>(null);

  const remove = async () => {
    if (!removing) return;
    await apiDelete(ownerPath(ownerId, `/roles/${encodeURIComponent(removing.id)}`));
    setRemoving(null);
    onChanged();
  };

  return (
    <div className={styles.card}>
      <div className={styles.toolbar}>
        <h2 className={styles.heading}>{t('owner.staff.tab.roles')}</h2>
        <Button onClick={() => setCreating(true)}>{t('owner.staff.roleAdd')}</Button>
      </div>
      {roles.length === 0 ? (
        <p className={styles.muted}>{t('owner.staff.roleEmpty')}</p>
      ) : (
        <Table caption={t('owner.staff.tab.roles')}>
          <thead>
            <tr>
              <th>{t('owner.staff.col.name')}</th>
              <th>{t('owner.staff.col.membersCount')}</th>
              <th>{t('owner.staff.col.perms')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className={styles.nameCell}>
                    {roleLabel(r, t)}
                    {r.system && <Badge tone="neutral">{t('owner.staff.system')}</Badge>}
                  </span>
                </td>
                <td className={styles.num}>{r.memberCount}</td>
                <td className={styles.num}>{r.permissions.length}</td>
                <td>
                  <div className={styles.rowActions}>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                      {t(r.system ? 'owner.staff.view' : 'owner.staff.edit')}
                    </Button>
                    {!r.system && (
                      <Button variant="ghost" size="sm" disabled={r.memberCount > 0} onClick={() => setRemoving(r)}>
                        {t('owner.staff.delete')}
                      </Button>
                    )}
                    {!r.system && r.memberCount > 0 && <span className={styles.muted}>{t('errors.role_in_use')}</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <RoleDialog open={creating} role={null} onClose={() => setCreating(false)} onSaved={onChanged} />
      <RoleDialog open={editing !== null} role={editing} onClose={() => setEditing(null)} onSaved={onChanged} />
      <ConfirmDeleteDialog
        open={removing !== null}
        title={t('owner.staff.deleteRoleTitle', { name: removing?.name ?? '' })}
        body={t('owner.staff.deleteRoleBody')}
        confirmLabel={t('owner.staff.deleteRoleConfirm')}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
      />
    </div>
  );
}

type DialogProps = { open: boolean; role: Role | null; onClose(): void; onSaved(): void };

/** Create (role null), edit or read-only view. The body is mounted only while open so every opening starts fresh. */
function RoleDialog({ open, role, onClose, onSaved }: DialogProps) {
  const { t } = useTranslation();
  const title = !role ? t('owner.staff.roleTitleAdd') : role.system ? t('owner.staff.roleTitleView', { name: roleLabel(role, t) }) : t('owner.staff.roleTitleEdit');
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {open && <RoleBody role={role} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

function RoleBody({ role, onClose, onSaved }: Omit<DialogProps, 'open'>) {
  const { t } = useTranslation();
  const { ownerId, membership } = useOwner();
  const readOnly = role?.system === true;
  const [name, setName] = useState(role?.name ?? '');
  const [perms, setPerms] = useState<Permission[]>(role?.permissions ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const err = (field: string) => (errors[field] ? t(errors[field]) : undefined);

  const toggle = (p: Permission, on: boolean) => setPerms((prev) => (on ? [...prev, p] : prev.filter((x) => x !== p)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || readOnly) return;
    setError(null);
    const trimmed = name.trim();
    const next: Record<string, string> = {};
    if (trimmed === '' || trimmed.length > NAME_MAX) next.name = 'owner.staff.err.roleName';
    if (perms.length === 0) next.perms = 'owner.staff.err.perms';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      if (role) {
        const body: { name?: string; permissions?: Permission[] } = {};
        if (trimmed !== role.name) body.name = trimmed;
        const same = perms.length === role.permissions.length && perms.every((p) => role.permissions.includes(p));
        if (!same) body.permissions = perms;
        if (Object.keys(body).length > 0) await apiPatch(ownerPath(ownerId, `/roles/${encodeURIComponent(role.id)}`), body);
      } else {
        await apiPost(ownerPath(ownerId, '/roles'), { name: trimmed, permissions: perms });
      }
      onSaved();
      onClose();
    } catch (e2) {
      setError(e2);
    }
    setBusy(false);
  };

  return (
    <form className={styles.body} onSubmit={submit} noValidate>
      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      {readOnly && <p className={styles.muted}>{t('owner.staff.systemReadonly')}</p>}
      <TextField
        label={t('owner.staff.field.roleName')}
        maxLength={NAME_MAX}
        value={name}
        disabled={readOnly}
        error={err('name')}
        onChange={(e) => setName(e.target.value)}
      />
      {GROUPS.map((g) => (
        <fieldset key={g.id} className={styles.fieldset}>
          <legend className={styles.legend}>{t(`owner.staff.group.${g.id}`)}</legend>
          {g.perms.map((p) => {
            const lacking = !membership.permissions.includes(p);
            return (
              <Checkbox
                key={p}
                label={t(permLabel(p))}
                checked={perms.includes(p)}
                disabled={readOnly || lacking}
                hint={!readOnly && lacking ? t('owner.staff.cannotGrant') : undefined}
                onChange={(on) => toggle(p, on)}
              />
            );
          })}
        </fieldset>
      ))}
      {err('perms') && <p className={styles.error}>{err('perms')}</p>}
      <div className={styles.actions}>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          {t('owner.staff.cancel')}
        </Button>
        {!readOnly && (
          <Button type="submit" loading={busy}>
            {t('owner.staff.save')}
          </Button>
        )}
      </div>
    </form>
  );
}
