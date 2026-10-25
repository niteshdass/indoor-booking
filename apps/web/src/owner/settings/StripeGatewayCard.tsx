import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Spinner } from '../../components/ui/Spinner';
import { TextField } from '../../components/ui/TextField';
import { ApiError, apiPatch, apiPut } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useResource } from '../useResource';
import styles from './settings.module.css';

/** What the API returns for a gateway; the credentials never come back. */
type GatewayView = {
  gateway: string;
  connected: boolean;
  enabled: boolean;
  mode: 'test' | 'live' | null;
  accountId: string | null;
  publishableKey: string | null;
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
function checkKeys(k: Keys): KeyErrors {
  const out: KeyErrors = {};
  if (!SECRET_RE.test(k.secretKey)) out.secretKey = 'secretKey';
  if (!PUBLISHABLE_RE.test(k.publishableKey)) out.publishableKey = 'publishableKey';
  if (!WEBHOOK_RE.test(k.webhookSecret)) out.webhookSecret = 'webhookSecret';
  if (!out.secretKey && !out.publishableKey && k.secretKey.split('_')[1] !== k.publishableKey.split('_')[1]) {
    out.publishableKey = 'mode';
  }
  return out;
}

function CopyField({ label, value }: { label: string; value: string }) {
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
        <TextField className={styles.grow} label={label} readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <Button variant="secondary" onClick={() => void copy()}>
          {t('owner.gateway.copy')}
        </Button>
      </div>
      <p className={styles.muted} role="status">
        {copied ? t('owner.gateway.copied') : ''}
      </p>
    </div>
  );
}

/** Stripe connection for the owner's card payments (`settings.edit`). */
export function StripeGatewayCard() {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  const base = ownerPath(ownerId, '/payment-gateways');
  const res = useResource<GatewayView[]>(base);
  const [replacing, setReplacing] = useState(false);
  const [keys, setKeys] = useState<Keys>(EMPTY);
  const [keyErrors, setKeyErrors] = useState<KeyErrors>({});
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
  const showForm = !stripe.connected || replacing;

  const toggle = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      store((await apiPatch<{ gateway: GatewayView }>(`${base}/stripe`, { enabled })).gateway);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const found = checkKeys(keys);
    setKeyErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const next = await apiPut<{ gateway: GatewayView }>(`${base}/stripe`, keys);
      setKeys(EMPTY);
      setReplacing(false);
      store(next.gateway);
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

  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.heading}>{title}</h2>
      <p className={styles.muted}>{t('owner.gateway.intro')}</p>
      {stripe.connected && stripe.mode && (
        <div className={styles.statusRow}>
          <Badge tone={stripe.mode === 'live' ? 'success' : 'warning'}>{t(`owner.gateway.mode.${stripe.mode}`)}</Badge>
          <span className={styles.muted}>{t('owner.gateway.account')}</span>
          <strong className={styles.account}>{stripe.accountId}</strong>
        </div>
      )}
      {stripe.connected && (
        <>
          <Checkbox label={t('owner.gateway.enabled')} checked={stripe.enabled} disabled={busy} onChange={(on) => void toggle(on)} />
          <h3 className={styles.subheading}>{t('owner.gateway.webhookTitle')}</h3>
          <p className={styles.muted}>{t('owner.gateway.webhookHint')}</p>
          <CopyField label={t('owner.gateway.webhookUrl')} value={stripe.webhookUrl} />
          <ul aria-label={t('owner.gateway.events')} className={styles.events}>
            {stripe.webhookEvents.map((ev) => (
              <li key={ev}>{ev}</li>
            ))}
          </ul>
          <CopyField label={t('owner.gateway.events')} value={stripe.webhookEvents.join(',')} />
        </>
      )}
      {showForm ? (
        <form className={styles.stack} onSubmit={(e) => void connect(e)} noValidate>
          {!stripe.connected && <p className={styles.muted}>{t('owner.gateway.notConnected')}</p>}
          <TextField
            label={t('owner.gateway.secretKey')}
            hint={t('owner.gateway.secretHint')}
            type="password"
            autoComplete="off"
            value={keys.secretKey}
            onChange={set('secretKey')}
            error={fieldError('secretKey')}
          />
          <TextField
            label={t('owner.gateway.publishableKey')}
            type="text"
            autoComplete="off"
            value={keys.publishableKey}
            onChange={set('publishableKey')}
            error={fieldError('publishableKey')}
          />
          <TextField
            label={t('owner.gateway.webhookSecret')}
            hint={t('owner.gateway.secretHint')}
            type="password"
            autoComplete="off"
            value={keys.webhookSecret}
            onChange={set('webhookSecret')}
            error={fieldError('webhookSecret')}
          />
          {failure && <Alert tone="danger">{failure}</Alert>}
          <div className={styles.actions}>
            {replacing && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setReplacing(false);
                  setKeys(EMPTY);
                  setKeyErrors({});
                  setError(null);
                }}
              >
                {t('owner.gateway.cancel')}
              </Button>
            )}
            <Button type="submit" loading={busy}>
              {t('owner.gateway.connect')}
            </Button>
          </div>
        </form>
      ) : (
        <>
          {failure && <Alert tone="danger">{failure}</Alert>}
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setReplacing(true)}>
              {t('owner.gateway.replace')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
