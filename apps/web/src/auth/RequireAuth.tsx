import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { useAuth } from './AuthProvider';
import styles from './auth.module.css';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, retry } = useAuth();
  const { pathname, search } = useLocation();
  const { t } = useTranslation();
  if (status === 'loading') return <Spinner label={t('common.loading')} />;
  if (status === 'offline') {
    return (
      <div className={styles.offline}>
        <Alert tone="warning">{t('auth.offline')}</Alert>
        <Button onClick={retry}>{t('auth.retry')}</Button>
      </div>
    );
  }
  if (status === 'signedOut') {
    return <Navigate to={'/login?next=' + encodeURIComponent(pathname + search)} replace />;
  }
  return <>{children}</>;
}
