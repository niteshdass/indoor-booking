import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SportCourt } from '../landing/SportCourt';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { apiDelete, apiGet } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { formatRating } from '../lib/format';
import type { SavedVenueJson } from '../lib/types';
import pageStyles from './MyBookingsPage.module.css';
import styles from './SavedVenues.module.css';

type State = { status: 'loading' } | { status: 'ready'; venues: SavedVenueJson[] } | { status: 'error'; error: unknown };

/** The "Saved" tab of My bookings: venues the player saved, newest first, each one tap from its page. */
export function SavedVenues() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [removeError, setRemoveError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    apiGet<{ venues: SavedVenueJson[] }>('/me/saved-venues').then(
      (r) => live && setState({ status: 'ready', venues: r.venues }),
      (error) => live && setState({ status: 'error', error }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const remove = async (v: SavedVenueJson) => {
    if (state.status !== 'ready') return;
    const before = state.venues;
    // Gone at once; back in its place if the request fails.
    setState({ status: 'ready', venues: before.filter((x) => x.slug !== v.slug) });
    try {
      await apiDelete(`/me/saved-venues/${encodeURIComponent(v.slug)}`);
      setRemoveError(null);
    } catch (err) {
      setState({ status: 'ready', venues: before });
      setRemoveError(err);
    }
  };

  if (state.status === 'loading') return <Skeleton kind="list" label={t('common.loading')} />;
  if (state.status === 'error') {
    return (
      <Alert tone="danger" className={pageStyles.alert}>
        <span>{errorMessage(state.error, t)}</span>
        <Button size="sm" variant="secondary" icon="refresh" onClick={() => setAttempt((n) => n + 1)}>
          {t('search.retry')}
        </Button>
      </Alert>
    );
  }
  if (state.venues.length === 0) {
    return (
      <EmptyState
        sport="football"
        title={t('savedVenues.empty')}
        description={t('savedVenues.emptyHint')}
        action={
          <Button to="/search" variant="brand" icon="search">
            {t('myBookings.findVenues')}
          </Button>
        }
      />
    );
  }
  return (
    <>
      {removeError != null && <Alert tone="danger">{errorMessage(removeError, t)}</Alert>}
      <ul className={pageStyles.list}>
        {state.venues.map((v) => (
          <li key={v.slug} className={styles.row}>
            <span className={styles.media} aria-hidden="true">
              {v.photo ? (
                <img className={styles.photo} src={v.photo.url} alt="" loading="lazy" />
              ) : (
                <span className={styles.court}>
                  <SportCourt sport={v.sports[0] ?? 'futsal'} className={styles.lines} />
                </span>
              )}
            </span>
            <span className={styles.body}>
              {/* Stretched over the row; the remove button sits above it. */}
              <Link to={`/venues/${encodeURIComponent(v.slug)}`} className={styles.name}>
                {v.name}
              </Link>
              <span className={styles.meta}>
                {v.address && v.address !== v.city ? `${v.address}, ${v.city}` : v.city}
              </span>
              {v.rating && (
                <span
                  role="img"
                  className={styles.rating}
                  aria-label={t('reviews.cardLabel', { value: formatRating(v.rating.average, lang), count: v.rating.count })}
                >
                  <span className={styles.star} aria-hidden="true">
                    ★
                  </span>{' '}
                  {formatRating(v.rating.average, lang)} <span className={styles.ratingCount}>({v.rating.count})</span>
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon="trash"
              className={styles.remove}
              aria-label={t('savedVenues.removeLabel', { venue: v.name })}
              onClick={() => void remove(v)}
            >
              {t('savedVenues.remove')}
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}
