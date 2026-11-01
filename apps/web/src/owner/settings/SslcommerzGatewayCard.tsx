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
import type { GatewayView } from '../types';
import { useResource } from '../useResource';
import { CopyField } from './StripeGatewayCard';
import styles from './settings.module.css';

type Mode = 'test' | 'live';
const MODES: Mode[] = ['test', 'live'];

// Same rules as the API's PUT schema.
const STORE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PASSWORD_RE = /^\S{1,128}$/;

type Creds = { storeId: string; storePassword: string };
type CredErrors = Partial<Record<keyof Creds, string>>;
const EMPTY: Creds = { storeId: '', storePassword: '' };

/** i18n keys (under `owner.sslcommerz.errors`) for whatever is wrong; empty when the form can be sent. */
function checkCreds(c: Creds): CredErrors {
  const out: CredErrors = {};
  if (!STORE_ID_RE.test(c.storeId)) out.storeId = 'storeId';
  if (!PASSWORD_RE.test(c.storePassword)) out.storePassword = 'storePassword';
  return out;
}

/** One mode's store: the saved store id, or the form to save it. The password is write-only. */
function ModeStore({ mode, view, base, onSaved }: { mode: Mode; view: GatewayView; base: string; onSaved(v: GatewayView): void }) {
  const { t } = useTranslation();
  const saved = view.accounts[mode];
  const [replacing, setReplacing] = useState(false);
  const [creds, setCreds] = useState<Creds>(EMPTY);
  const [credErrors, setCredErrors] = useState<CredErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const reset = () => {
    setReplacing(false);
    setCreds(EMPTY);
    setCredErrors({});
    setError(null);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const found = checkCreds(creds);
    setCredErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const next = await apiPut<{ gateway: GatewayView }>(`${base}/sslcommerz`, { ...creds, mode });
      reset();
      onSaved(next.gateway);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };

  const set = (k: keyof Creds) => (e: { target: { value: string } }) => {
    setCreds({ ...creds, [k]: e.target.value.trim() });
    setCredErrors({ ...credErrors, [k]: undefined });
  };
  const fieldError = (k: keyof Creds) => (credErrors[k] ? t(`owner.sslcommerz.errors.${credErrors[k]}`) : undefined);
  const failure =
    error instanceof ApiError && error.code === 'invalid_credentials'
      ? t('owner.sslcommerz.errors.invalidCreds')
      : error !== null
        ? errorMessage(error, t)
        : null;

  if (saved && !replacing) {
    return (
      <div className={styles.stack}>
        <div className={styles.statusRow}>
          <span className={styles.muted}>{t('owner.sslcommerz.storeId')}</span>
          <strong className={styles.account}>{saved.accountId}</strong>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" icon="edit" onClick={() => setReplacing(true)}>
            {t('owner.sslcommerz.replace')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.stack} onSubmit={(e) => void save(e)} noValidate>
      {!saved && <p className={styles.muted}>{t(`owner.sslcommerz.noStore.${mode}`)}</p>}
      <TextField
        icon="key"
        label={t('owner.sslcommerz.storeId')}
        type="text"
        autoComplete="off"
        value={creds.storeId}
        onChange={set('storeId')}
        error={fieldError('storeId')}
      />
      <TextField
        icon="key"
        label={t('owner.sslcommerz.storePassword')}
        hint={t('owner.gateway.secretHint')}
        type="password"
        autoComplete="off"
        value={creds.storePassword}
        onChange={set('storePassword')}
        error={fieldError('storePassword')}
      />
      {failure && <Alert tone="danger">{failure}</Alert>}
      <div className={styles.actions}>
        {replacing && (
          <Button variant="secondary" disabled={busy} onClick={reset}>
            {t('owner.gateway.cancel')}
          </Button>
        )}
        <Button icon="check" type="submit" loading={busy}>
          {t(`owner.sslcommerz.save.${mode}`)}
        </Button>
      </div>
    </form>
  );
}

/** SSLCommerz connection for online checkout (`settings.edit`): sandbox and live stores, the active mode. */
export function SslcommerzGatewayCard() {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  const base = ownerPath(ownerId, '/payment-gateways');
  const res = useResource<GatewayView[]>(base);
  const [tab, setTab] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const title = t('owner.sslcommerz.title');
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
  const gw = list.find((g) => g.gateway === 'sslcommerz');
  if (!gw) return null;
  const store = (next: GatewayView) => res.set(list.map((g) => (g.gateway === next.gateway ? next : g)));
  const shown: Mode = tab ?? gw.mode ?? 'test';

  const patch = async (body: { enabled?: boolean; mode?: Mode }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      store((await apiPatch<{ gateway: GatewayView }>(`${base}/sslcommerz`, body)).gateway);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };

  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.heading}>{title}</h2>
      <p className={styles.muted}>{t('owner.sslcommerz.intro')}</p>
      <div className={styles.split}>
        <div className={styles.column}>
          {gw.connected && gw.mode ? (
            <>
              <div className={styles.statusRow}>
                <Badge tone={gw.mode === 'live' ? 'success' : 'warning'}>{t(`owner.sslcommerz.mode.${gw.mode}`)}</Badge>
                <span className={styles.muted}>{t(`owner.sslcommerz.modeHint.${gw.mode}`)}</span>
              </div>
              <Select
                icon="mode"
                layout="stacked"
                label={t('owner.gateway.activeMode')}
                value={gw.mode}
                disabled={busy}
                options={MODES.filter((m) => gw.accounts[m]).map((m) => ({ value: m, label: t(`owner.sslcommerz.mode.${m}`) }))}
                onChange={(e) => void patch({ mode: e.target.value as Mode })}
              />
              {!gw.accounts.live && <p className={styles.muted}>{t('owner.sslcommerz.addLiveHint')}</p>}
              <Checkbox label={t('owner.sslcommerz.enabled')} checked={gw.enabled} disabled={busy} onChange={(on) => void patch({ enabled: on })} />
              {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
            </>
          ) : (
            <p className={styles.muted}>{t('owner.sslcommerz.notConnected')}</p>
          )}

          <h3 className={styles.subheading}>{t('owner.sslcommerz.storeTitle')}</h3>
          <Tabs
            label={t('owner.sslcommerz.storeTitle')}
            tabs={MODES.map((m) => ({ id: m, label: t(`owner.sslcommerz.mode.${m}`) }))}
            value={shown}
            onChange={(id) => setTab(id as Mode)}
          />
          <div role="tabpanel" aria-label={t(`owner.sslcommerz.mode.${shown}`)}>
            <ModeStore key={shown} mode={shown} view={gw} base={base} onSaved={store} />
          </div>
        </div>

        <div className={styles.column}>
          <h3 className={styles.subheading}>{t('owner.sslcommerz.ipnTitle')}</h3>
          <p className={styles.muted}>{t('owner.sslcommerz.ipnHint')}</p>
          <CopyField label={t('owner.sslcommerz.ipnUrl')} value={gw.webhookUrl} />
          <Alert tone="info">{t('owner.sslcommerz.whitelistHint')}</Alert>
        </div>
      </div>
    </section>
  );
}
