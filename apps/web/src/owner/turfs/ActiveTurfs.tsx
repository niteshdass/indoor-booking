import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import styles from '../ownerForm.module.css';
import type { OwnerTurf, OwnerVenue } from '../types';
import { useResource } from '../useResource';

/** Loads the venue's turfs and renders `children` with the active ones; handles loading, error/retry and "none". */
export function ActiveTurfs({ venue, children }: { venue: OwnerVenue; children: (turfs: OwnerTurf[]) => ReactNode }) {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  const turfs = useResource<{ turfs: OwnerTurf[] }>(ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/turfs`));
  if (turfs.state.status === 'error') {
    return (
      <Alert tone="danger">
        <p className={styles.empty}>{errorMessage(turfs.state.error, t)}</p>
        <Button variant="secondary" onClick={turfs.reload}>
          {t('auth.retry')}
        </Button>
      </Alert>
    );
  }
  if (turfs.state.status !== 'ready') return <Spinner label={t('common.loading')} />;
  const active = turfs.state.data.turfs.filter((x) => x.active);
  if (active.length === 0) return <p className={styles.empty}>{t('owner.walkIn.noTurfs')}</p>;
  return <>{children(active)}</>;
}
