import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { useOwner } from './OwnerProvider';
import type { Permission } from './types';

/** Renders `children` when the member holds all of `perm` (any of them with `any`), else a no-access notice. */
export function RequirePermission({ perm, any = false, children }: { perm: Permission | Permission[]; any?: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const { can } = useOwner();
  const list = Array.isArray(perm) ? perm : [perm];
  const allowed = any ? list.some(can) : list.every(can);
  return allowed ? <>{children}</> : <Alert tone="info">{t('owner.noAccess')}</Alert>;
}
