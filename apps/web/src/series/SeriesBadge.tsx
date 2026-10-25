import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SERIES_STATUSES, type SeriesStatus } from '@booking/shared';
import { Badge, type Tone } from '../components/ui/Badge';
import styles from './series.module.css';

const TONE: Record<SeriesStatus, Tone> = {
  requested: 'warning',
  active: 'success',
  declined: 'danger',
  withdrawn: 'neutral',
  cancelled: 'danger',
  ended: 'neutral',
};

export const SERIES_STATUS_OPTIONS = SERIES_STATUSES;

export function SeriesStatusBadge({ status }: { status: SeriesStatus }) {
  const { t } = useTranslation();
  return <Badge tone={TONE[status]}>{t(`series.status.${status}`)}</Badge>;
}

/** Marks a booking as part of a series. With `href` it links to the series; without, it is a plain badge. */
export function SeriesBadge({ href }: { href?: string }) {
  const { t } = useTranslation();
  const badge = <Badge tone="info">{t('series.badge')}</Badge>;
  if (!href) return badge;
  return (
    <Link to={href} className={styles.badgeLink}>
      {badge}
    </Link>
  );
}
