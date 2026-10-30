import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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

/** Whether the owner's Stripe account can take card payments; false when it cannot be read. */
export function useStripeReady(): { ready: boolean; canConnect: boolean } {
  const { ownerId, can } = useOwner();
  const res = useResource<Array<{ gateway: string; connected: boolean; enabled: boolean }>>(
    can('settings.edit') ? ownerPath(ownerId, '/payment-gateways') : null,
  );
  const ready = res.state.status === 'ready' && res.state.data.some((g) => g.gateway === 'stripe' && g.connected && g.enabled);
  return { ready, canConnect: can('settings.edit') };
}

type Props = {
  value: PaymentMethods;
  onChange(v: PaymentMethods): void;
  disabled: boolean;
  stripeReady: boolean;
  /** Whether this user can connect Stripe, so the "connect first" hint is useful. */
  canConnectStripe?: boolean;
};

/** One row per wallet provider (number, account type, note) plus the card switch. */
export function PaymentMethodsFields({ value, onChange, disabled, stripeReady, canConnectStripe = true }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<WalletProvider | null>(null);
  const wallets = value.manualWallets ?? [];
  const setWallets = (next: ManualWallet[]) => onChange({ ...value, manualWallets: next });
  const patchWallet = (provider: WalletProvider, patch: Partial<ManualWallet>) =>
    setWallets(wallets.map((w) => (w.provider === provider ? { ...w, ...patch } : w)));
  const gateways = value.gateways ?? [];
  const card = gateways.includes('stripe');

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
                  layout="stacked"
                  label={t('owner.settings.methods.accountType')}
                  value={wallet.accountType}
                  disabled={disabled}
                  options={ACCOUNT_TYPES.map((v) => ({ value: v, label: t(`owner.settings.methods.account.${v}`) }))}
                  onChange={(e) => patchWallet(provider, { accountType: e.target.value as ManualWallet['accountType'] })}
                />
                <TextField
                  className={styles.walletNote}
                  label={t('owner.settings.methods.note')}
                  maxLength={140}
                  value={wallet.note ?? ''}
                  disabled={disabled}
                  onChange={(e) => {
                    const { note: _drop, ...rest } = wallet;
                    const next: ManualWallet = e.target.value === '' ? rest : { ...rest, note: e.target.value };
                    setWallets(wallets.map((w) => (w.provider === provider ? next : w)));
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
      <Checkbox
        label={t('owner.settings.methods.card')}
        checked={card}
        disabled={disabled || (!stripeReady && !card)}
        hint={stripeReady || card || !canConnectStripe ? undefined : t('owner.settings.methods.connectStripe')}
        onChange={(on) => onChange({ ...value, gateways: on ? [...gateways, 'stripe'] : gateways.filter((g) => g !== 'stripe') })}
      />
    </div>
  );
}
