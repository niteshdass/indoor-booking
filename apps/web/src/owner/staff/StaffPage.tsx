import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Paged } from '../../components/ui/Pagination';
import { Table } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { apiDelete } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { roleLabel } from '../roleLabel';
import { ConfirmDeleteDialog } from '../schedule/ConfirmDeleteDialog';
import { useOwnerTitle } from '../shell/OwnerShell';
import type { Member, Role } from '../types';
import { useResource, type ResourceState } from '../useResource';
import { MemberDialog } from './MemberDialog';
import { RoleEditor } from './RoleEditor';
import styles from './staff.module.css';

const TABS = ['members', 'roles'] as const;
type Tab = (typeof TABS)[number];

/** Members and roles of this owner (`staff.manage`). Both lists load up front: member changes move role counts and vice versa. */
export function StaffPage() {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  useOwnerTitle(t('owner.staff.title'));
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: Tab = TABS.find((x) => x === requested) ?? 'members';
  const setTab = (id: string) => setParams(id === 'members' ? {} : { tab: id }, { replace: true });
  const members = useResource<{ members: Member[] }>(ownerPath(ownerId, '/members'));
  const roles = useResource<{ roles: Role[] }>(ownerPath(ownerId, '/roles'));
  const reloadAll = () => {
    members.reload();
    roles.reload();
  };

  return (
    <div className={styles.page}>
      <Tabs label={t('owner.staff.title')} tabs={TABS.map((id) => ({ id, label: t(`owner.staff.tab.${id}`) }))} value={tab} onChange={setTab} />
      {tab === 'members' && (
        <Loaded state={members.state} reload={members.reload}>
          {(m) => (
            <Loaded state={roles.state} reload={roles.reload}>
              {(r) => <MembersTab members={m.members} roles={r.roles} onChanged={reloadAll} />}
            </Loaded>
          )}
        </Loaded>
      )}
      {tab === 'roles' && (
        <Loaded state={roles.state} reload={roles.reload}>
          {(r) => <RoleEditor roles={r.roles} onChanged={reloadAll} />}
        </Loaded>
      )}
    </div>
  );
}

function Loaded<T>({ state, reload, children }: { state: ResourceState<T>; reload(): void; children(data: T): ReactNode }) {
  const { t } = useTranslation();
  if (state.status === 'error') {
    return (
      <Alert tone="danger">
        <p className={styles.muted}>{errorMessage(state.error, t)}</p>
        <Button variant="secondary" onClick={reload}>
          {t('owner.staff.retry')}
        </Button>
      </Alert>
    );
  }
  if (state.status !== 'ready') return <Skeleton kind="table" label={t('common.loading')} />;
  return <>{children(state.data)}</>;
}

function MembersTab({ members, roles, onChanged }: { members: Member[]; roles: Role[]; onChanged(): void }) {
  const { t } = useTranslation();
  const { ownerId, membership, venues } = useOwner();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const venueNames = (scope: Member['venueIds']) => {
    if (scope === 'all') return t('owner.staff.allVenues');
    const names = scope.map((id) => venues.find((v) => v.id === id)?.name).filter((n): n is string => Boolean(n));
    return names.length > 0 ? names.join(', ') : '—';
  };
  const remove = async () => {
    if (!removing) return;
    await apiDelete(ownerPath(ownerId, `/members/${encodeURIComponent(removing.id)}`));
    setRemoving(null);
    onChanged();
  };

  return (
    <div className={styles.card}>
      <div className={styles.toolbar}>
        <h2 className={styles.heading}>{t('owner.staff.tab.members')}</h2>
        <Button onClick={() => setCreating(true)}>{t('owner.staff.memberAdd')}</Button>
      </div>
      {members.length === 0 ? (
        <EmptyState size="sm" bare sport="basketball" title={t('owner.staff.memberEmpty')} />
      ) : (
        <Paged items={members}>
          {(rows) => (
            <Table caption={t('owner.staff.tab.members')}>
              <thead>
                <tr>
                  <th>{t('owner.staff.col.name')}</th>
                  <th>{t('owner.staff.col.contact')}</th>
                  <th>{t('owner.staff.col.role')}</th>
                  <th>{t('owner.staff.col.venues')}</th>
                  <th>{t('owner.staff.col.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const self = m.id === membership.id;
                  // The API refuses changes to the caller's own row and to the owner's (cannot_modify_self, owner_membership_locked).
                  const locked = self || m.role.key === 'owner';
                  return (
                    <tr key={m.id}>
                      <td>
                        <span className={styles.nameCell}>
                          {m.user.name}
                          {self && <Badge tone="info">{t('owner.staff.you')}</Badge>}
                        </span>
                      </td>
                      <td>
                        <span className={styles.stack}>
                          {m.user.email && <span>{m.user.email}</span>}
                          {m.user.phone && <span className={styles.num}>{m.user.phone}</span>}
                        </span>
                      </td>
                      <td>{roleLabel(m.role, t)}</td>
                      <td>{venueNames(m.venueIds)}</td>
                      <td>
                        <Badge tone={m.status === 'active' ? 'success' : 'neutral'}>{t(`owner.staff.status.${m.status}`)}</Badge>
                      </td>
                      <td>
                        {!locked && (
                          <div className={styles.rowActions}>
                            <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                              {t('owner.staff.edit')}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setRemoving(m)}>
                              {t('owner.staff.remove')}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Paged>
      )}
      <MemberDialog open={creating} member={null} roles={roles} onClose={() => setCreating(false)} onSaved={onChanged} />
      <MemberDialog open={editing !== null} member={editing} roles={roles} onClose={() => setEditing(null)} onSaved={onChanged} />
      <ConfirmDeleteDialog
        open={removing !== null}
        title={t('owner.staff.removeTitle', { name: removing?.user.name ?? '' })}
        body={t('owner.staff.removeBody')}
        confirmLabel={t('owner.staff.removeConfirm')}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
      />
    </div>
  );
}
