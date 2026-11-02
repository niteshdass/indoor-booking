import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { Button } from '../components/ui/Button';
import { apiDelete, apiGet, apiPut } from '../lib/apiClient';
import styles from './VenuePage.module.css';

type Props = {
  slug: string;
  /** A save or remove failed (the button is back as it was); null once one works. */
  onError(err: unknown): void;
};

/** Saves the venue to the player's list; signed out it leads to sign-in and back. */
export function SaveVenueButton({ slug, onError }: Props) {
  const { t } = useTranslation();
  const { status } = useAuth();
  const { pathname, search } = useLocation();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const path = `/me/saved-venues/${encodeURIComponent(slug)}`;

  useEffect(() => {
    if (status !== 'signedIn') return;
    let live = true;
    apiGet<{ saved: boolean }>(path).then(
      (r) => live && setSaved(r.saved),
      // Unknown state: offer to save, which is safe to repeat.
      () => live && setSaved(false),
    );
    return () => {
      live = false;
    };
  }, [status, path]);

  if (status !== 'signedIn') {
    return (
      <Button
        to={'/login?next=' + encodeURIComponent(pathname + search)}
        variant="secondary"
        icon="heart"
        className={styles.share}
      >
        {t('savedVenues.save')}
      </Button>
    );
  }

  const toggle = async () => {
    // Not disabled while busy, so focus stays on it; a second tap waits for the first.
    if (busy || saved === null) return;
    const was = saved;
    // Shown at once; put back if the request fails.
    setSaved(!was);
    setBusy(true);
    try {
      if (was) await apiDelete(path);
      else await apiPut(path, {});
      onError(null);
    } catch (err) {
      setSaved(was);
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="secondary"
      icon="heart"
      className={[styles.share, saved && styles.saved].filter(Boolean).join(' ')}
      disabled={saved === null}
      onClick={() => void toggle()}
    >
      <span role="status">{saved ? t('savedVenues.saved') : t('savedVenues.save')}</span>
    </Button>
  );
}
