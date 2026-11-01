import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { WALLET_PROVIDERS, type ManualWallet, type PaymentMethods, type WalletProvider } from '@booking/shared';
import { Checkbox } from '../../components/ui/Checkbox';
import { Select } from '../../components/ui/Select';
import { TextField } from '../../components/ui/TextField';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useResource } from '../useResource';
import { PROVIDER_NAMES, formatBdMobile } from '../../lib/wallets';
import styles from './settings.module.css';

const ACCOUNT_TYPES: ManualWallet['accountType'][] = ['personal', 'merchant', 'agent'];

export type GatewayKey = PaymentMethods['gateways'][number];
/** The order the gateway switches appear in. */
const GATEWAY_KEYS: GatewayKey[] = ['sslcommerz', 'stripe'];

/** The owner's gateways that are connected and on; empty when they cannot be read. */
export function useReadyGateways(): { ready: GatewayKey[]; canConnect: boolean } {
  const { ownerId, can } = useOwner();
  const res = useResource<Array<{ gateway: string; connected: boolean; enabled: boolean }>>(
    can('settings.edit') ? ownerPath(ownerId, '/payment-gateways') : null,
  );
  const list = res.state.status === 'ready' ? res.state.data : [];
  const ready = GATEWAY_KEYS.filter((k) => list.some((g) => g.gateway === k && g.connected && g.enabled));
  return { ready, canConnect: can('settings.edit') };
}

type Props = {
  value: PaymentMethods;
  onChange(v: PaymentMethods): void;
  disabled: boolean;
  /** Gateways connected and on; a gateway's switch stays off until then. */
  readyGateways: GatewayKey[];
  /** Whether this user can connect a gateway, so the "connect first" hint is useful. */
  canConnectGateways?: boolean;
};

/** One row per wallet provider (number, account type, note) plus a switch per gateway. */
export function PaymentMethodsFields({ value, onChange, disabled, readyGateways, canConnectGateways = true }: Props) {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  const [editing, setEditing] = useState<WalletProvider | null>(null);
  const wallets = value.manualWallets ?? [];
  const setWallets = (next: ManualWallet[]) => onChange({ ...value, manualWallets: next });
  const patchWallet = (provider: WalletProvider, patch: Partial<ManualWallet>) =>
    setWallets(wallets.map((w) => (w.provider === provider ? { ...w, ...patch } : w)));
  const gateways = value.gateways ?? [];

  return (
    <div className={styles.methods}>
      {WALLET_PROVIDERS.map((provider) => {
        const wallet = wallets.find((w) => w.provider === provider);
        return (
          <div key={provider} className={styles.walletRow}>
            <Checkbox
              label={PROVIDER_NAMES[provider]}
              checked={wallet !== undefined}
              disabled={disabled}
              onChange={(on) =>
                setWallets(
                  on
                    ? [...wallets, { provider, number: '', accountType: 'personal' }]
                    : wallets.filter((w) => w.provider !== provider),
                )
              }
            />
            {wallet && (
              <div className={styles.walletFields}>
                <TextField
                  icon="phone"
                  label={t('owner.settings.methods.number')}
                  inputMode="tel"
                  autoComplete="off"
                  value={editing === provider ? wallet.number : formatBdMobile(wallet.number)}
                  disabled={disabled}
                  onFocus={() => setEditing(provider)}
                  onBlur={() => setEditing(null)}
                  onChange={(e) => patchWallet(provider, { number: e.target.value })}
                />
                <Select
                  icon="wallet"
                  layout="stacked"
                  label={t('owner.settings.methods.accountType')}
                  value={wallet.accountType}
                  disabled={disabled}
                  options={ACCOUNT_TYPES.map((v) => ({ value: v, label: t(`owner.settings.methods.account.${v}`) }))}
                  onChange={(e) => patchWallet(provider, { accountType: e.target.value as ManualWallet['accountType'] })}
                />
                <TextField
                  icon="note"
                  className={styles.walletNote}
                  label={t('owner.settings.methods.note')}
                  maxLength={140}
                  value={wallet.note ?? ''}
                  disabled={disabled}
                  onChange={(e) => {
                    const next: ManualWallet = { ...wallet, note: e.target.value };
                    if (e.target.value === '') delete next.note;
                    setWallets(wallets.map((w) => (w.provider === provider ? next : w)));
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
      {GATEWAY_KEYS.map((key) => {
        const on = gateways.includes(key);
        const ready = readyGateways.includes(key);
        return (
          <Checkbox
            key={key}
            label={t(`owner.settings.methods.gateway.${key}`)}
            checked={on}
            disabled={disabled || (!ready && !on)}
            hint={
              ready || on || !canConnectGateways ? undefined : (
                <Link to={`/owner/${encodeURIComponent(ownerId)}/settings?section=${key}`} className={styles.link}>
                  {t(`owner.settings.methods.connect.${key}`)}
                </Link>
              )
            }
            onChange={(next) => onChange({ ...value, gateways: next ? [...gateways, key] : gateways.filter((g) => g !== key) })}
          />
        );
      })}
    </div>
  );
}
