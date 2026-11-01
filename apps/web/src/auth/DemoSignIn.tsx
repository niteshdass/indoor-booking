import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEMO_ROLES, type DemoRole } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import type { IconName } from '../components/ui/Icon';
import { apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import type { AuthResponse } from '../lib/types';
import { authProviders } from './providers';
import styles from './auth.module.css';

const ICONS: Record<DemoRole, IconName> = { admin: 'key', owner: 'venue', player: 'person' };

/** One button per seeded role on a demo deploy (DEMO_MODE=true), with an "or" rule under it; renders nothing otherwise. */
export function DemoSignIn({ onSignedIn }: { onSignedIn(res: AuthResponse): void }) {
  const { t } = useTranslation();
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState<DemoRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void authProviders().then((p) => {
      if (!cancelled) setDemo(p.demo);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!demo) return null;

  const signIn = (role: DemoRole) => {
    setBusy(role);
    setError(null);
    apiPost<AuthResponse>(`/auth/demo/${role}`, {}).then(onSignedIn, (err) => {
      setError(errorMessage(err, t));
      setBusy(null);
    });
  };

  return (
    <>
      <section className={styles.demo} aria-labelledby="demo-title">
        <h2 id="demo-title" className={styles.demoTitle}>
          {t('auth.demo.title')}
        </h2>
        <p className={styles.hint}>{t('auth.demo.lead')}</p>
        <div className={styles.demoRoles}>
          {DEMO_ROLES.map((role) => (
            <Button
              key={role}
              variant="secondary"
              size="lg"
              icon={ICONS[role]}
              block
              loading={busy === role}
              disabled={busy !== null}
              onClick={() => signIn(role)}
            >
              {t(`auth.demo.roles.${role}`)}
            </Button>
          ))}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </section>
      <div className={styles.divider} role="separator">
        <span>{t('auth.or')}</span>
      </div>
    </>
  );
}
