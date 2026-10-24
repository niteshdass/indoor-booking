import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Spinner } from '../components/ui/Spinner';
import { useAuth } from './AuthProvider';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const { pathname, search } = useLocation();
  const { t } = useTranslation();
  if (status === 'loading') return <Spinner label={t('common.loading')} />;
  if (status === 'signedOut') {
    return <Navigate to={'/login?next=' + encodeURIComponent(pathname + search)} replace />;
  }
  return <>{children}</>;
}
