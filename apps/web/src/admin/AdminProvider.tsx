import { createContext, useContext, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { AdminMeJson } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { ApiError } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { useResource } from '../owner/useResource';
import styles from '../owner/owner.module.css';

const AdminContext = createContext<AdminMeJson | null>(null);

export function useAdmin(): AdminMeJson {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used inside AdminProvider');
  return ctx;
}

/** Loads the signed-in user's platform role; anyone without one sees "no access" instead of the portal. */
export function AdminProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { state, reload } = useResource<AdminMeJson>('/admin/me');
  if (state.status === 'error') {
    const denied = state.error instanceof ApiError && state.error.status === 403;
    return (
      <div className={styles.state}>
        <Alert tone={denied ? 'warning' : 'danger'}>{denied ? t('admin.noAccess') : errorMessage(state.error, t)}</Alert>
        {denied ? (
          <Link to="/">{t('admin.home')}</Link>
        ) : (
          <Button variant="secondary" icon="refresh" onClick={reload}>
            {t('auth.retry')}
          </Button>
        )}
      </div>
    );
  }
  if (state.status !== 'ready') return <Spinner label={t('common.loading')} />;
  return <AdminContext.Provider value={state.data}>{children}</AdminContext.Provider>;
}
