import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PAYOUT_WEBHOOK_EVENTS, type AdminSettingsJson, type ManualWallet } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Select } from '../../components/ui/Select';
import { Tabs } from '../../components/ui/Tabs';
import { TextField } from '../../components/ui/TextField';
import { ApiError } from '../../lib/apiClient';
import { PROVIDER_NAMES, formatBdMobile } from '../../lib/wallets';
import { CopyField } from '../../owner/settings/StripeGatewayCard';
import { Card, serverFields, useSection, type Store } from './shared';
import settings from '../../owner/settings/settings.module.css';
import styles from './GeneralTab.module.css';

type General = AdminSettingsJson['general'];
type PayoutStripe = NonNullable<General['payout']['stripe']>;
type Provider = 'bkash' | 'nagad';
type Mode = 'test' | 'live';

const PROVIDERS: Provider[] = ['bkash', 'nagad'];
const ACCOUNT_TYPES: ManualWallet['accountType'][] = ['personal', 'merchant', 'agent'];
const MODES: Mode[] = ['test', 'live'];

// Same patterns as the API's Stripe key fields.
const SECRET_RE = /^(sk|rk)_(test|live)_\S+$/;
const PUBLISHABLE_RE = /^pk_(test|live)_\S+$/;
const WEBHOOK_RE = /^whsec_\S+$/;

/** bKash and Nagad numbers owners pay to. They live in the General section, so the saved signup and fee go along unchanged. */
function WalletsCard({ general, store }: { general: General; store: Store }) {
  const { t } = useTranslation();
  const s = useSection('general', store);
  const [wallets, setWallets] = useState<Record<Provider, ManualWallet | null>>({ bkash: general.payout.bkash, nagad: general.payout.nagad });
  const [editing, setEditing] = useState<Provider | null>(null);
  /** Wallets edited since the last save; their server errors no longer apply. */
  const [touched, setTouched] = useState<ReadonlySet<Provider>>(new Set());
  const fromServer = new Set([...serverFields(s.failure)].filter((f): f is Provider => f !== 'fixed' && f !== 'percent' && !touched.has(f)));
  const g = (key: string) => t(`admin.settings.general.${key}`);

  const setWallet = (p: Provider, w: ManualWallet | null) => setWallets({ ...wallets, [p]: w });
  const touch = (p: Provider) => !touched.has(p) && setTouched(new Set([...touched, p]));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(new Set());
    const payout = Object.fromEntries(
      PROVIDERS.map((p) => {
        const w = wallets[p];
        return [p, w ? { ...w, number: w.number.trim() } : null];
      }),
    );
    const { mode, fixed, percent, payer } = general.fee;
    void s.save({ ownerApproval: general.ownerApproval, fee: { mode, fixed, percent, payer }, payout });
  };

  return (
    <Card title={g('payout.wallets')} intro={g('payout.walletsIntro')}>
      <form className={settings.stack} onSubmit={submit} noValidate>
        <div className={styles.wallets}>
          {PROVIDERS.map((p) => {
            const w = wallets[p];
            return (
              <div key={p} className={settings.walletRow}>
                <Checkbox
                  label={PROVIDER_NAMES[p]}
                  checked={w !== null}
                  onChange={(on) => setWallet(p, on ? { provider: p, number: '', accountType: 'personal' } : null)}
                />
                {w && (
                  <div className={settings.walletFields}>
                    <TextField
                      icon="phone"
                      label={g(`payout.number.${p}`)}
                      inputMode="tel"
                      autoComplete="off"
                      placeholder="01712345678"
                      value={editing === p ? w.number : formatBdMobile(w.number)}
                      onFocus={() => setEditing(p)}
                      onBlur={() => setEditing(null)}
                      onChange={(e) => {
                        setWallet(p, { ...w, number: e.target.value });
                        touch(p);
                      }}
                      error={fromServer.has(p) ? g('errors.number') : undefined}
                    />
                    <Select
                      icon="wallet"
                      layout="stacked"
                      label={g('payout.accountType')}
                      value={w.accountType}
                      options={ACCOUNT_TYPES.map((v) => ({ value: v, label: t(`owner.settings.methods.account.${v}`) }))}
                      onChange={(e) => setWallet(p, { ...w, accountType: e.target.value as ManualWallet['accountType'] })}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {s.error && <Alert tone="danger">{s.error}</Alert>}
        <div className={settings.actions}>
          {s.saved && (
            <p className={`${settings.muted} ${styles.savedNote}`} role="status">
              {t('admin.settings.saved')}
            </p>
          )}
          <Button type="submit" icon="check" loading={s.busy}>
            {g('payout.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** One mode's payout Stripe keys: what is saved, or the form to (re)enter them. There is no PATCH, so mode and the on switch go with the keys. */
function PayoutKeys({ mode, stripe, secrets, store }: { mode: Mode; stripe: PayoutStripe | null; secrets: boolean; store: Store }) {
  const { t } = useTranslation();
  const s = useSection('payout-stripe', store);
  const saved = stripe?.keys[mode] ?? null;
  const [replacing, setReplacing] = useState(false);
  const [keys, setKeys] = useState({ secretKey: '', publishableKey: '', webhookSecret: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof keys, string>>>({});
  const [makeActive, setMakeActive] = useState(false);
  const [enabled, setEnabled] = useState(stripe?.enabled ?? true);
  // Saving the inactive mode's keys keeps the active mode unless asked to switch.
  const switchable = stripe !== null && stripe.mode !== mode;

  const reset = () => {
    setReplacing(false);
    setKeys({ secretKey: '', publishableKey: '', webhookSecret: '' });
    setErrors({});
    setMakeActive(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    if (!SECRET_RE.test(keys.secretKey)) found.secretKey = 'secretKey';
    else if (keys.secretKey.split('_')[1] !== mode) found.secretKey = `wrongMode.${mode}`;
    if (!PUBLISHABLE_RE.test(keys.publishableKey)) found.publishableKey = 'publishableKey';
    else if (keys.publishableKey.split('_')[1] !== mode) found.publishableKey = `wrongMode.${mode}`;
    if (!WEBHOOK_RE.test(keys.webhookSecret)) found.webhookSecret = 'webhookSecret';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const active: Mode = switchable && !makeActive ? stripe.mode : mode;
    if (await s.save({ mode: active, ...keys, enabled })) reset();
  };

  const set = (k: keyof typeof keys) => (e: { target: { value: string } }) => {
    setKeys({ ...keys, [k]: e.target.value.trim() });
    setErrors({ ...errors, [k]: undefined });
  };
  const fieldError = (k: keyof typeof keys) => (errors[k] ? t(`owner.gateway.errors.${errors[k]}`) : undefined);
  const failure =
    s.failure instanceof ApiError && s.failure.code === 'invalid_credentials'
      ? t('owner.gateway.errors.invalidKeys')
      : s.failure instanceof ApiError && s.failure.code === 'gateway_mode_not_connected'
        ? t('admin.settings.general.stripe.modeNotConnected')
        : s.error;

  if (saved && !replacing) {
    return (
      <div className={settings.stack}>
        <div className={settings.statusRow}>
          <span className={settings.muted}>{t('owner.gateway.account')}</span>
          <strong className={settings.account}>{saved.accountId}</strong>
        </div>
        <div className={settings.statusRow}>
          <span className={settings.muted}>{t('owner.gateway.publishableKey')}</span>
          <code className={settings.account}>{saved.publishableKey}</code>
        </div>
        <div className={settings.actions}>
          <Button variant="secondary" icon="edit" disabled={!secrets} onClick={() => setReplacing(true)}>
            {t('owner.gateway.replace')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className={settings.stack} onSubmit={(e) => void submit(e)} noValidate>
      {!saved && <p className={settings.muted}>{t(`owner.gateway.noKeys.${mode}`)}</p>}
      <TextField
        icon="key"
        label={t('owner.gateway.secretKey')}
        hint={t('owner.gateway.secretHint')}
        type="password"
        autoComplete="off"
        placeholder={`sk_${mode}_…`}
        disabled={!secrets}
        value={keys.secretKey}
        onChange={set('secretKey')}
        error={fieldError('secretKey')}
      />
      <TextField
        icon="key"
        label={t('owner.gateway.publishableKey')}
        autoComplete="off"
        placeholder={`pk_${mode}_…`}
        disabled={!secrets}
        value={keys.publishableKey}
        onChange={set('publishableKey')}
        error={fieldError('publishableKey')}
      />
      <TextField
        icon="key"
        label={t('owner.gateway.webhookSecret')}
        hint={t('admin.settings.general.stripe.webhookSecretHint')}
        type="password"
        autoComplete="off"
        placeholder="whsec_…"
        disabled={!secrets}
        value={keys.webhookSecret}
        onChange={set('webhookSecret')}
        error={fieldError('webhookSecret')}
      />
      {switchable && (
        <Checkbox label={t('admin.settings.general.stripe.makeActive')} checked={makeActive} disabled={!secrets} onChange={setMakeActive} />
      )}
      <Checkbox label={t('admin.settings.general.stripe.enabled')} checked={enabled} disabled={!secrets} onChange={setEnabled} />
      {failure && <Alert tone="danger">{failure}</Alert>}
      <div className={settings.actions}>
        {replacing && (
          <Button variant="secondary" disabled={s.busy} onClick={reset}>
            {t('owner.gateway.cancel')}
          </Button>
        )}
        <Button icon="check" type="submit" loading={s.busy} disabled={!secrets}>
          {t(`owner.gateway.save.${mode}`)}
        </Button>
      </div>
    </form>
  );
}

/** The admin's own Stripe account that owners pay by card: status, Test and Live keys, and removal. Keys save on their own. */
function PayoutStripeCard({ general, secrets, store }: { general: General; secrets: boolean; store: Store }) {
  const { t } = useTranslation();
  const stripe = general.payout.stripe;
  const [tab, setTab] = useState<Mode | null>(null);
  const shown: Mode = tab ?? stripe?.mode ?? 'test';
  const removal = useSection('payout-stripe', store);
  return (
    <Card title={t('admin.settings.general.stripe.title')} intro={t('admin.settings.general.stripe.intro')}>
      {stripe ? (
        <>
          <div className={settings.statusRow}>
            <Badge tone={stripe.mode === 'live' ? 'success' : 'warning'}>{t(`owner.gateway.mode.${stripe.mode}`)}</Badge>
            <Badge tone={stripe.enabled ? 'success' : 'neutral'}>{t(`admin.settings.general.stripe.${stripe.enabled ? 'on' : 'off'}`)}</Badge>
          </div>
          <p className={settings.muted}>{t('admin.settings.general.stripe.needKeys')}</p>
        </>
      ) : (
        <div className={settings.statusRow}>
          <Badge tone="neutral">{t('owner.gateway.notConnected')}</Badge>
        </div>
      )}
      {!secrets && <Alert tone="warning">{t('admin.settings.general.stripe.noKey')}</Alert>}
      <h3 className={settings.subheading}>{t('owner.gateway.keysTitle')}</h3>
      <Tabs label={t('owner.gateway.keysTitle')} tabs={MODES.map((m) => ({ id: m, label: t(`owner.gateway.mode.${m}`) }))} value={shown} onChange={(id) => setTab(id as Mode)} />
      <div role="tabpanel" aria-label={t(`owner.gateway.mode.${shown}`)}>
        <PayoutKeys key={`${shown}-${stripe?.mode ?? ''}-${String(stripe?.enabled)}`} mode={shown} stripe={stripe} secrets={secrets} store={store} />
      </div>
      {stripe && (
        <>
          <hr className={styles.rule} />
          {removal.error && <Alert tone="danger">{removal.error}</Alert>}
          <div className={styles.removeRow}>
            <span className={settings.muted}>{t('admin.settings.general.stripe.removeHint')}</span>
            <Button variant="secondary" icon="trash" loading={removal.busy} onClick={() => void removal.remove()}>
              {t('admin.settings.general.stripe.remove')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/** Admin > Settings > Payments: where owners pay what they owe, one card per way, each with its own save. */
export function PaymentsTab({ data, store }: { data: AdminSettingsJson; store: Store }) {
  const { t } = useTranslation();
  const general = data.general;
  return (
    <>
      <div className={styles.wide}>
        <WalletsCard general={general} store={store} />
      </div>
      <PayoutStripeCard general={general} secrets={data.secretsAvailable} store={store} />
      <Card title={t('admin.settings.general.payout.webhookTitle')} intro={t('admin.settings.general.stripe.webhookHint')}>
        <CopyField label={t('owner.gateway.webhookUrl')} value={general.payoutWebhookUrl} />
        <ul aria-label={t('owner.gateway.events')} className={settings.events}>
          {PAYOUT_WEBHOOK_EVENTS.map((ev) => (
            <li key={ev}>{ev}</li>
          ))}
        </ul>
        <CopyField label={t('owner.gateway.events')} value={PAYOUT_WEBHOOK_EVENTS.join(',')} />
      </Card>
    </>
  );
}
