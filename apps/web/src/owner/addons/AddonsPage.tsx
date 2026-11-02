import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Paged } from '../../components/ui/Pagination';
import { Table } from '../../components/ui/Table';
import { apiDelete } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { ConfirmDeleteDialog } from '../schedule/ConfirmDeleteDialog';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import type { Addon } from '../types';
import { useResource } from '../useResource';
import { AddonForm } from './AddonFormDialog';
import styles from './addons.module.css';

/** The owner-wide add-on catalogue. Writes need `addon.manage` on every venue, so venue-scoped members get a note instead. */
export function AddonsPage() {
  const { t, i18n } = useTranslation();
  const { ownerId, membership } = useOwner();
  useOwnerTitle(t('owner.nav.addons'));
  const writable = membership.venueIds === 'all';
  const { state, reload } = useResource<{ addons: Addon[] }>(ownerPath(ownerId, '/addons'));
  const [editing, setEditing] = useState<Addon | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Addon | null>(null);

  const remove = async () => {
    if (!removing) return;
    await apiDelete(ownerPath(ownerId, `/addons/${encodeURIComponent(removing.id)}`));
    setRemoving(null);
    reload();
  };

  return (
    <div className={styles.card}>
      <div className={styles.toolbar}>
        <h2 className={styles.heading}>{t('owner.addons.title')}</h2>
        {writable && <Button icon="plus" onClick={() => setCreating(true)}>{t('owner.addons.add')}</Button>}
      </div>
      <p className={styles.muted}>{t('owner.addons.intro')}</p>
      {!writable && <Alert tone="info">{t('owner.addons.ownerWideOnly')}</Alert>}
      {state.status === 'error' && (
        <Alert tone="danger">
          <p className={styles.muted}>{errorMessage(state.error, t)}</p>
          <Button variant="secondary" icon="refresh" onClick={reload}>
            {t('auth.retry')}
          </Button>
        </Alert>
      )}
      {(state.status === 'loading' || state.status === 'idle') && <Skeleton kind="table" label={t('common.loading')} />}
      {state.status === 'ready' &&
        (state.data.addons.length === 0 ? (
          <EmptyState sport="volleyball" title={t('owner.addons.empty')} />
        ) : (
          <Paged items={state.data.addons}>
            {(rows) => (
              <Table caption={t('owner.addons.title')}>
                <thead>
                  <tr>
                    <th>{t('owner.addons.col.name')}</th>
                    <th>{t('owner.addons.col.type')}</th>
                    <th>{t('owner.addons.col.price')}</th>
                    <th>{t('owner.addons.col.maxQuantity')}</th>
                    <th>{t('owner.addons.col.stock')}</th>
                    <th>{t('owner.addons.col.auto')}</th>
                    {writable && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>{t(`owner.addons.type.${a.pricingType}`)}</td>
                      <td className={styles.num}>{money(a.price, a.currency, i18n.language)}</td>
                      <td className={styles.num}>{a.maxQuantity}</td>
                      <td className={styles.num}>{a.stock ?? t('owner.addons.unlimited')}</td>
                      <td>{a.autoApply ? <Badge tone="info">{t('owner.addons.autoBadge')}</Badge> : t('owner.addons.none')}</td>
                      {writable && (
                        <td>
                          <div className={styles.rowActions}>
                            <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditing(a)} data-row-link>
                              {t('owner.addons.edit')}
                            </Button>
                            <Button variant="ghost" size="sm" icon="trash" onClick={() => setRemoving(a)}>
                              {t('owner.addons.delete')}
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Paged>
        ))}
      {writable && (
        <>
          <AddonForm open={creating} addon={null} onClose={() => setCreating(false)} onSaved={reload} />
          <AddonForm open={editing !== null} addon={editing} onClose={() => setEditing(null)} onSaved={reload} />
          <ConfirmDeleteDialog
            open={removing !== null}
            title={t('owner.addons.deleteTitle', { name: removing?.name ?? '' })}
            body={t('owner.addons.deleteBody')}
            confirmLabel={t('owner.addons.deleteConfirm')}
            onClose={() => setRemoving(null)}
            onConfirm={remove}
          />
        </>
      )}
    </div>
  );
}
