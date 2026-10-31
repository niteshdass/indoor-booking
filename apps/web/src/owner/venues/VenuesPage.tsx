import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Paged } from '../../components/ui/Pagination';
import { Table } from '../../components/ui/Table';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import type { OwnerTurf } from '../types';
import { useResource } from '../useResource';
import styles from './venues.module.css';

/** Turf count of one venue, loaded per row; a dash while loading or when it failed. */
function TurfCount({ venueId }: { venueId: string }) {
  const { ownerId } = useOwner();
  const { state } = useResource<{ turfs: OwnerTurf[] }>(ownerPath(ownerId, `/venues/${encodeURIComponent(venueId)}/turfs`));
  return <>{state.status === 'ready' ? state.data.turfs.length : '—'}</>;
}

export function VenuesPage() {
  const { t } = useTranslation();
  const { venues, can, membership } = useOwner();
  useOwnerTitle(t('owner.nav.venues'));
  const canCreate = can('venue.manage') && membership.venueIds === 'all';

  return (
    <div className={styles.page}>
      {canCreate && (
        <div className={styles.toolbar}>
          <Button icon="plus" to="new">{t('owner.venues.new')}</Button>
        </div>
      )}
      {venues.length === 0 ? (
        <EmptyState sport="futsal" title={t('owner.venues.empty')} />
      ) : (
        <Paged items={venues}>
          {(rows) => (
            <Table caption={t('owner.nav.venues')}>
              <thead>
                <tr>
                  <th>{t('owner.venues.name')}</th>
                  <th>{t('owner.venues.city')}</th>
                  <th>{t('owner.venues.status')}</th>
                  <th>{t('owner.venues.turfs')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Link to={encodeURIComponent(v.id)} className={styles.link}>
                        {v.name}
                      </Link>
                    </td>
                    <td>{v.city}</td>
                    <td>
                      <Badge tone={v.published ? 'success' : 'neutral'}>{t(v.published ? 'owner.venues.published' : 'owner.venues.draft')}</Badge>
                    </td>
                    <td>
                      <TurfCount venueId={v.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Paged>
      )}
    </div>
  );
}
