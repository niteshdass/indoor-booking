import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Select } from '../../components/ui/Select';
import { Spinner } from '../../components/ui/Spinner';
import { Tabs } from '../../components/ui/Tabs';
import { TextField } from '../../components/ui/TextField';
import { ApiError, apiPatch, apiPut } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useResource } from '../useResource';
import styles from './settings.module.css';

type Mode = 'test' | 'live';
const MODES: Mode[] = ['test', 'live'];

/** What the API returns for a gateway; the credentials never come back. */
type GatewayView = {
  gateway: string;
  connected: boolean;
  enabled: boolean;
  /** The active mode: new payments use its keys. */
  mode: Mode | null;
  accounts: Record<Mode, { accountId: string; publishableKey: string } | null>;
  webhookUrl: string;
  webhookEvents: string[];
  updatedAt: string | null;
};

// Same patterns as the API's PUT schema.
const SECRET_RE = /^(sk|rk)_(test|live)_\S+$/;
const PUBLISHABLE_RE = /^pk_(test|live)_\S+$/;
const WEBHOOK_RE = /^whsec_\S+$/;

type Keys = { secretKey: string; publishableKey: string; webhookSecret: string };
type KeyErrors = Partial<Record<keyof Keys, string>>;
const EMPTY: Keys = { secretKey: '', publishableKey: '', webhookSecret: '' };

/** Returns i18n keys (under `owner.gateway.errors`) for whatever is wrong; empty when the form can be sent. */
function checkKeys(k: Keys, mode: Mode): KeyErrors {
  const out: KeyErrors = {};
  if (!SECRET_RE.test(k.secretKey)) out.secretKey = 'secretKey';
  else if (k.secretKey.split('_')[1] !== mode) out.secretKey = `wrongMode.${mode}`;
  if (!PUBLISHABLE_RE.test(k.publishableKey)) out.publishableKey = 'publishableKey';
  else if (k.publishableKey.split('_')[1] !== mode) out.publishableKey = `wrongMode.${mode}`;
  if (!WEBHOOK_RE.test(k.webhookSecret)) out.webhookSecret = 'webhookSecret';
  return out;
}

export function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false); // the field is selectable as a fallback
    }
  };
  return (
    <div>
      <div className={styles.copyRow}>
        <TextField icon="link" className={styles.grow} label={label} readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <Button variant="secondary" icon="copy" onClick={() => void copy()}>
          {t('owner.gateway.copy')}
        </Button>
      </div>
      <p className={styles.muted} role="status">
        {copied ? t('owner.gateway.copied') : ''}
      </p>
    </div>
  );
}

/** One mode's keys: what is saved, or the form to save them. Secrets are write-only. */
function ModeKeys({ mode, view, base, onSaved }: { mode: Mode; view: GatewayView; base: string; onSaved(v: GatewayView): void }) {
  const { t } = useTranslation();
  const saved = view.accounts[mode];
  const [replacing, setReplacing] = useState(false);
  const [keys, setKeys] = useState<Keys>(EMPTY);
  const [keyErrors, setKeyErrors] = useState<KeyErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const reset = () => {
    setReplacing(false);
    setKeys(EMPTY);
    setKeyErrors({});
    setError(null);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const found = checkKeys(keys, mode);
    setKeyErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const next = await apiPut<{ gateway: GatewayView }>(`${base}/stripe`, keys);
      reset();
      onSaved(next.gateway);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };

  const set = (k: keyof Keys) => (e: { target: { value: string } }) => {
    setKeys({ ...keys, [k]: e.target.value.trim() });
    setKeyErrors({ ...keyErrors, [k]: undefined });
  };
  const fieldError = (k: keyof Keys) => (keyErrors[k] ? t(`owner.gateway.errors.${keyErrors[k]}`) : undefined);
  // The API reuses `invalid_credentials` (the login message) when Stripe rejects the keys.
  const failure =
    error instanceof ApiError && error.code === 'invalid_credentials' ? t('owner.gateway.errors.invalidKeys') : error !== null ? errorMessage(error, t) : null;

  if (saved && !replacing) {
    return (
      <div className={styles.stack}>
        <div className={styles.statusRow}>
          <span className={styles.muted}>{t('owner.gateway.account')}</span>
          <strong className={styles.account}>{saved.accountId}</strong>
        </div>
        <div className={styles.statusRow}>
          <span className={styles.muted}>{t('owner.gateway.publishableKey')}</span>
          <code className={styles.account}>{saved.publishableKey}</code>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" icon="edit" onClick={() => setReplacing(true)}>
            {t('owner.gateway.replace')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.stack} onSubmit={(e) => void save(e)} noValidate>
      {!saved && <p className={styles.muted}>{t(`owner.gateway.noKeys.${mode}`)}</p>}
      <TextField
        icon="key"
        label={t('owner.gateway.secretKey')}
        hint={t('owner.gateway.secretHint')}
        type="password"
        autoComplete="off"
        placeholder={`sk_${mode}_…`}
        value={keys.secretKey}
        onChange={set('secretKey')}
        error={fieldError('secretKey')}
      />
      <TextField
        icon="key"
        label={t('owner.gateway.publishableKey')}
        type="text"
        autoComplete="off"
        placeholder={`pk_${mode}_…`}
        value={keys.publishableKey}
        onChange={set('publishableKey')}
        error={fieldError('publishableKey')}
      />
      <TextField
        icon="key"
        label={t('owner.gateway.webhookSecret')}
        hint={t('owner.gateway.webhookSecretHint')}
        type="password"
        autoComplete="off"
        placeholder="whsec_…"
        value={keys.webhookSecret}
        onChange={set('webhookSecret')}
        error={fieldError('webhookSecret')}
      />
      {failure && <Alert tone="danger">{failure}</Alert>}
      <div className={styles.actions}>
        {replacing && (
          <Button variant="secondary" disabled={busy} onClick={reset}>
            {t('owner.gateway.cancel')}
          </Button>
        )}
        <Button icon="check" type="submit" loading={busy}>
          {t(`owner.gateway.save.${mode}`)}
        </Button>
      </div>
    </form>
  );
}

/** Stripe connection for the owner's card payments (`settings.edit`): test and live keys, the active mode, the webhook. */
export function StripeGatewayCard() {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  const base = ownerPath(ownerId, '/payment-gateways');
  const res = useResource<GatewayView[]>(base);
  const [tab, setTab] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const title = t('owner.gateway.title');
  if (res.state.status === 'error') {
    return (
      <section className={styles.card}>
        <h2 className={styles.heading}>{title}</h2>
        <Alert tone="danger">{errorMessage(res.state.error, t)}</Alert>
      </section>
    );
  }
  if (res.state.status !== 'ready') return <Spinner label={t('common.loading')} />;
  const list = res.state.data;
  const stripe = list.find((g) => g.gateway === 'stripe');
  if (!stripe) return null;
  const store = (next: GatewayView) => res.set(list.map((g) => (g.gateway === next.gateway ? next : g)));
  const shown: Mode = tab ?? stripe.mode ?? 'test';

  const patch = async (body: { enabled?: boolean; mode?: Mode }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      store((await apiPatch<{ gateway: GatewayView }>(`${base}/stripe`, body)).gateway);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };

  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.heading}>{title}</h2>
      <p className={styles.muted}>{t('owner.gateway.intro')}</p>
      <div className={styles.split}>
      <div className={styles.column}>
      {stripe.connected && stripe.mode ? (
        <>
          <div className={styles.statusRow}>
            <Badge tone={stripe.mode === 'live' ? 'success' : 'warning'}>{t(`owner.gateway.mode.${stripe.mode}`)}</Badge>
            <span className={styles.muted}>{t(`owner.gateway.modeHint.${stripe.mode}`)}</span>
          </div>
          <Select
            icon="mode"
            layout="stacked"
            label={t('owner.gateway.activeMode')}
            value={stripe.mode}
            disabled={busy}
            options={MODES.filter((m) => stripe.accounts[m]).map((m) => ({ value: m, label: t(`owner.gateway.mode.${m}`) }))}
            onChange={(e) => void patch({ mode: e.target.value as Mode })}
          />
          {!stripe.accounts.live && <p className={styles.muted}>{t('owner.gateway.addLiveHint')}</p>}
          <Checkbox label={t('owner.gateway.enabled')} checked={stripe.enabled} disabled={busy} onChange={(on) => void patch({ enabled: on })} />
          {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
        </>
      ) : (
        <p className={styles.muted}>{t('owner.gateway.notConnected')}</p>
      )}

      <h3 className={styles.subheading}>{t('owner.gateway.keysTitle')}</h3>
      <Tabs label={t('owner.gateway.keysTitle')} tabs={MODES.map((m) => ({ id: m, label: t(`owner.gateway.mode.${m}`) }))} value={shown} onChange={(id) => setTab(id as Mode)} />
      <div role="tabpanel" aria-label={t(`owner.gateway.mode.${shown}`)}>
        <ModeKeys key={shown} mode={shown} view={stripe} base={base} onSaved={store} />
      </div>
      </div>

      <div className={styles.column}>
      <h3 className={styles.subheading}>{t('owner.gateway.webhookTitle')}</h3>
      <p className={styles.muted}>{t('owner.gateway.webhookHint')}</p>
      <CopyField label={t('owner.gateway.webhookUrl')} value={stripe.webhookUrl} />
      <ul aria-label={t('owner.gateway.events')} className={styles.events}>
        {stripe.webhookEvents.map((ev) => (
          <li key={ev}>{ev}</li>
        ))}
      </ul>
      <CopyField label={t('owner.gateway.events')} value={stripe.webhookEvents.join(',')} />
      </div>
      </div>
    </section>
  );
}
