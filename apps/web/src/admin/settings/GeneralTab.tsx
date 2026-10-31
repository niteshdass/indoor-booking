import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FEE_PAYERS,
  PLATFORM_FEE_MAX_PERCENT,
  PAYOUT_WEBHOOK_EVENTS,
  PLATFORM_FEE_MODES,
  formatMoney,
  platformFeeFor,
  type AdminSettingsJson,
  type FeePayer,
  type ManualWallet,
  type OwnerApprovalMode,
  type PlatformFeeMode,
} from '@booking/shared';
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
import { Card, useSection, type Store } from './shared';
import settings from '../../owner/settings/settings.module.css';
import styles from './GeneralTab.module.css';

type General = AdminSettingsJson['general'];
type PayoutStripe = NonNullable<General['payout']['stripe']>;
type Provider = 'bkash' | 'nagad';
type Mode = 'test' | 'live';

const APPROVALS: OwnerApprovalMode[] = ['manual', 'automatic'];
const PROVIDERS: Provider[] = ['bkash', 'nagad'];
const ACCOUNT_TYPES: ManualWallet['accountType'][] = ['personal', 'merchant', 'agent'];
const MODES: Mode[] = ['test', 'live'];
/** The same limit as the API's fixed-fee schema. */
const FIXED_MAX = 1_000_000;
/** The example's court price: ৳1,000 in minor units. */
const EXAMPLE_BASE = 100_000;
const EXAMPLE_CURRENCY = 'BDT';

// Same patterns as the API's Stripe key fields.
const SECRET_RE = /^(sk|rk)_(test|live)_\S+$/;
const PUBLISHABLE_RE = /^pk_(test|live)_\S+$/;
const WEBHOOK_RE = /^whsec_\S+$/;

/** A positive amount with at most 2 decimals, up to `max`; a comma is read as the decimal point. Null when it is not one. */
function parseAmount(text: string, max: number): number | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const n = Number(clean);
  return n > 0 && n <= max ? n : null;
}

/** Which field each validation issue from the server belongs to (zod `path` joined with dots). */
type ServerField = 'fixed' | 'percent' | Provider;

function serverFields(err: unknown): Set<ServerField> {
  const out = new Set<ServerField>();
  if (!(err instanceof ApiError) || err.code !== 'validation_error' || !Array.isArray(err.details)) return out;
  for (const issue of err.details as Array<{ path?: unknown }>) {
    if (!Array.isArray(issue.path)) continue;
    const [a, b] = issue.path as string[];
    if (a === 'fee' && (b === 'fixed' || b === 'percent')) out.add(b);
    if (a === 'payout' && (b === 'bkash' || b === 'nagad')) out.add(b);
  }
  return out;
}

type Option<T extends string> = { value: T; label: string; hint?: string };

/** A segmented single choice (radio group) whose options can carry a hint line. */
function Choice<T extends string>({ legend, value, options, onChange }: { legend: string; value: T; options: Option<T>[]; onChange(v: T): void }) {
  const name = useId();
  return (
    <fieldset className={styles.choice}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.options}>
        {options.map((o) => {
          const id = `${name}-${o.value}`;
          return (
            <label key={o.value} className={styles.option}>
              <input
                className={styles.radio}
                type="radio"
                name={name}
                value={o.value}
                checked={o.value === value}
                aria-labelledby={`${id}-label`}
                aria-describedby={o.hint ? `${id}-hint` : undefined}
                onChange={() => onChange(o.value)}
              />
              <span id={`${id}-label`} className={styles.optionLabel}>
                {o.label}
              </span>
              {o.hint && (
                <span id={`${id}-hint`} className={styles.optionHint}>
                  {o.hint}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
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

/** The admin's own Stripe account that owners pay by card, with the platform webhook to copy. */
function PayoutStripeSection({ general, secrets, store }: { general: General; secrets: boolean; store: Store }) {
  const { t } = useTranslation();
  const stripe = general.payout.stripe;
  const [tab, setTab] = useState<Mode | null>(null);
  const shown: Mode = tab ?? stripe?.mode ?? 'test';
  const removal = useSection('payout-stripe', store);
  return (
    <div className={settings.split}>
      <div className={settings.column}>
        <h3 className={settings.subheading}>{t('admin.settings.general.stripe.title')}</h3>
        <p className={settings.muted}>{t('admin.settings.general.stripe.intro')}</p>
        {stripe ? (
          <>
            <div className={settings.statusRow}>
              <Badge tone={stripe.mode === 'live' ? 'success' : 'warning'}>{t(`owner.gateway.mode.${stripe.mode}`)}</Badge>
              <Badge tone={stripe.enabled ? 'success' : 'neutral'}>{t(`admin.settings.general.stripe.${stripe.enabled ? 'on' : 'off'}`)}</Badge>
            </div>
            <p className={settings.muted}>{t('admin.settings.general.stripe.needKeys')}</p>
          </>
        ) : (
          <p className={settings.muted}>{t('owner.gateway.notConnected')}</p>
        )}
        {!secrets && <p className={settings.muted}>{t('admin.settings.general.stripe.noKey')}</p>}
        <p className={settings.muted}>{t('admin.settings.general.stripe.separate')}</p>
        <h3 className={settings.subheading}>{t('owner.gateway.keysTitle')}</h3>
        <Tabs label={t('owner.gateway.keysTitle')} tabs={MODES.map((m) => ({ id: m, label: t(`owner.gateway.mode.${m}`) }))} value={shown} onChange={(id) => setTab(id as Mode)} />
        <div role="tabpanel" aria-label={t(`owner.gateway.mode.${shown}`)}>
          <PayoutKeys key={`${shown}-${stripe?.mode ?? ''}-${String(stripe?.enabled)}`} mode={shown} stripe={stripe} secrets={secrets} store={store} />
        </div>
        {stripe && (
          <div className={settings.stack}>
            {removal.error && <Alert tone="danger">{removal.error}</Alert>}
            <div className={styles.removeRow}>
              <span className={settings.muted}>{t('admin.settings.general.stripe.removeHint')}</span>
              <Button variant="secondary" icon="trash" loading={removal.busy} onClick={() => void removal.remove()}>
                {t('admin.settings.general.stripe.remove')}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className={settings.column}>
        <h3 className={settings.subheading}>{t('owner.gateway.webhookTitle')}</h3>
        <p className={settings.muted}>{t('admin.settings.general.stripe.webhookHint')}</p>
        <CopyField label={t('owner.gateway.webhookUrl')} value={general.payoutWebhookUrl} />
        <ul aria-label={t('owner.gateway.events')} className={settings.events}>
          {PAYOUT_WEBHOOK_EVENTS.map((ev) => (
            <li key={ev}>{ev}</li>
          ))}
        </ul>
        <CopyField label={t('owner.gateway.events')} value={PAYOUT_WEBHOOK_EVENTS.join(',')} />
      </div>
    </div>
  );
}

/** Admin > Settings > General: venue signup approval, the platform fee and where owners pay it. One Save covers all but the Stripe keys. */
export function GeneralTab({ data, store }: { data: AdminSettingsJson; store: Store }) {
  const { t, i18n } = useTranslation();
  const general = data.general;
  const s = useSection('general', store);
  const [approval, setApproval] = useState<OwnerApprovalMode>(general.ownerApproval);
  const [mode, setMode] = useState<PlatformFeeMode>(general.fee.mode);
  const [fixed, setFixed] = useState(general.fee.fixed !== null ? String(general.fee.fixed) : '');
  const [percent, setPercent] = useState(general.fee.percent !== null ? String(general.fee.percent) : '');
  const [payer, setPayer] = useState<FeePayer>(general.fee.payer);
  const [wallets, setWallets] = useState<Record<Provider, ManualWallet | null>>({ bkash: general.payout.bkash, nagad: general.payout.nagad });
  const [editing, setEditing] = useState<Provider | null>(null);
  const [submitted, setSubmitted] = useState(false);
  /** Fields edited since the last save; their server errors no longer apply. */
  const [touched, setTouched] = useState<ReadonlySet<ServerField>>(new Set());

  const fixedValue = parseAmount(fixed, FIXED_MAX);
  const percentValue = parseAmount(percent, PLATFORM_FEE_MAX_PERCENT);
  const badFixed = mode === 'fixed' && fixedValue === null;
  const badPercent = mode === 'percent' && percentValue === null;
  const fromServer = new Set([...serverFields(s.failure)].filter((f) => !touched.has(f)));
  const touch = (f: ServerField) => !touched.has(f) && setTouched(new Set([...touched, f]));
  const g = (key: string, opts?: Record<string, unknown>) => t(`admin.settings.general.${key}`, opts);

  const fee = { mode, fixed: mode === 'fixed' ? fixedValue : null, percent: mode === 'percent' ? percentValue : null, payer };
  const snapshot = mode === 'free' ? null : platformFeeFor(fee, EXAMPLE_BASE, EXAMPLE_CURRENCY);
  const money = (minor: number) => formatMoney(minor, EXAMPLE_CURRENCY, i18n.language);

  const save = () => {
    setSubmitted(true);
    if (badFixed || badPercent) return;
    setTouched(new Set());
    const payout = Object.fromEntries(
      PROVIDERS.map((p) => {
        const w = wallets[p];
        return [p, w ? { ...w, number: w.number.trim() } : null];
      }),
    );
    void s.save({ ownerApproval: approval, fee, payout });
  };

  const setWallet = (p: Provider, w: ManualWallet | null) => setWallets({ ...wallets, [p]: w });

  return (
    <>
      <Card title={g('signup.title')} intro={g('signup.intro')}>
        <Choice<OwnerApprovalMode>
          legend={g('approval.label')}
          value={approval}
          onChange={setApproval}
          options={APPROVALS.map((v) => ({ value: v, label: g(`approval.${v}`), hint: g(`approval.${v}Hint`) }))}
        />
      </Card>

      <Card title={g('fee.title')} intro={g('fee.intro')}>
        <Choice<PlatformFeeMode>
          legend={g('fee.mode')}
          value={mode}
          onChange={setMode}
          options={PLATFORM_FEE_MODES.map((v) => ({ value: v, label: g(`mode.${v}`), hint: g(`mode.${v}Hint`) }))}
        />
        {mode === 'fixed' && (
          <TextField
            icon="money"
            label={g('fee.fixed')}
            hint={g('fee.fixedHint')}
            inputMode="decimal"
            autoComplete="off"
            placeholder="50"
            value={fixed}
            onChange={(e) => {
              setFixed(e.target.value);
              touch('fixed');
            }}
            error={(submitted && badFixed) || fromServer.has('fixed') ? g('errors.fixed') : undefined}
          />
        )}
        {mode === 'percent' && (
          <TextField
            icon="percent"
            label={g('fee.percent')}
            hint={g('fee.percentHint')}
            inputMode="decimal"
            autoComplete="off"
            placeholder="5"
            value={percent}
            onChange={(e) => {
              setPercent(e.target.value);
              touch('percent');
            }}
            error={(submitted && badPercent) || fromServer.has('percent') ? g('errors.percent') : undefined}
          />
        )}
        {mode !== 'free' && (
          <Choice<FeePayer>
            legend={g('fee.payer')}
            value={payer}
            onChange={setPayer}
            options={FEE_PAYERS.map((v) => ({ value: v, label: g(`payer.${v}`), hint: g(`payer.${v}Hint`) }))}
          />
        )}
        {snapshot && (
          <p className={styles.example} aria-live="polite">
            <span className={styles.exampleLabel}>{g('exampleLabel')}</span>{' '}
            {payer === 'player'
              ? g('examplePlayer', { base: money(EXAMPLE_BASE), total: money(EXAMPLE_BASE + snapshot.amount), fee: money(snapshot.amount) })
              : g('exampleOwner', { base: money(EXAMPLE_BASE), fee: money(snapshot.amount) })}
          </p>
        )}
      </Card>

      <div className={styles.wide}>
        <Card title={g('payout.title')} intro={g('payout.intro')}>
          <h3 className={settings.subheading}>{g('payout.wallets')}</h3>
          <div className={styles.wallets}>
            {PROVIDERS.map((p) => {
              const w = wallets[p];
              const bad = fromServer.has(p);
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
                        error={bad ? g('errors.number') : undefined}
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
          <hr className={styles.rule} />
          <PayoutStripeSection general={general} secrets={data.secretsAvailable} store={store} />
        </Card>
      </div>

      <div className={`${styles.wide} ${settings.stack}`}>
        {s.error && <Alert tone="danger">{s.error}</Alert>}
        <div className={settings.actions}>
          {s.saved && (
            <p className={`${settings.muted} ${styles.savedNote}`} role="status">
              {t('admin.settings.saved')}
            </p>
          )}
          <Button icon="check" loading={s.busy} onClick={save}>
            {g('save')}
          </Button>
        </div>
      </div>
    </>
  );
}
