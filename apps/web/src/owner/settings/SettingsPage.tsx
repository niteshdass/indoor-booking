import { useTranslation } from 'react-i18next';
import type { OwnerSettings } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Skeleton } from '../../components/ui/Skeleton';
import { apiPatch } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import { useResource } from '../useResource';
import { SettingsForm } from './SettingsForm';
import { useReadyGateways } from './PaymentMethodsFields';
import { SslcommerzGatewayCard } from './SslcommerzGatewayCard';
import { StripeGatewayCard } from './StripeGatewayCard';
import styles from './settings.module.css';

/** Owner-wide defaults (`settings.edit` to change; read-only otherwise). */
export function SettingsPage() {
  const { t } = useTranslation();
  const { ownerId, owner, can } = useOwner();
  useOwnerTitle(t('owner.nav.settings'));
  const path = ownerPath(ownerId, '/settings');
  const gateways = useReadyGateways();
  const res = useResource<{ settings: OwnerSettings }>(path);

  if (res.state.status === 'error') return <Alert tone="danger">{errorMessage(res.state.error, t)}</Alert>;
  if (res.state.status !== 'ready') return <Skeleton kind="detail" label={t('common.loading')} />;
  const settings = res.state.data.settings;

  const save = async (patch: Record<string, unknown>) => {
    const next = await apiPatch<{ settings: OwnerSettings }>(path, patch);
    res.set(next);
  };

  return (
    <div className={styles.page}>
      <SettingsForm
        level="owner"
        stored={settings}
        effective={settings}
        inherited={null}
        currency={owner.defaultCurrency}
        onSave={save}
        disabled={!can('settings.edit')}
        readyGateways={gateways.ready}
        canConnectGateways={gateways.canConnect}
        stripe={can('settings.edit') ? <StripeGatewayCard /> : undefined}
        sslcommerz={can('settings.edit') ? <SslcommerzGatewayCard /> : undefined}
      />
    </div>
  );
}
