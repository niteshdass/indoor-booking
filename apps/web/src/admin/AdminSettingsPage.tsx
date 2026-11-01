import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { AdminSettingsJson, SettingSource } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { Skeleton } from '../components/ui/Skeleton';
import { Tabs } from '../components/ui/Tabs';
import { TextField } from '../components/ui/TextField';
import { apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { useResource } from '../owner/useResource';
import { useAdminTitle } from './AdminShell';
import { dayTime } from './parts';
import { GeneralTab } from './settings/GeneralTab';
import { PaymentsTab } from './settings/PaymentsTab';
import { SportsTab } from './settings/SportsTab';
import { Card, failureText, useSection, type SettingsTab, type Store } from './settings/shared';
import styles from '../owner/settings/settings.module.css';

function Footer({ s, source, label }: { s: ReturnType<typeof useSection>; source: SettingSource; label: string }) {
  const { t } = useTranslation();
  return (
    <>
      {s.error && <Alert tone="danger">{s.error}</Alert>}
      {s.saved && (
        <p className={styles.muted} role="status">
          {t('admin.settings.saved')}
        </p>
      )}
      <div className={styles.actions}>
        {source === 'admin' && (
          <Button variant="secondary" icon="trash" disabled={s.busy} onClick={() => void s.remove()}>
            {t('admin.settings.remove')}
          </Button>
        )}
        <Button type="submit" icon="check" loading={s.busy}>
          {label}
        </Button>
      </div>
    </>
  );
}

/** "Send a test" row under the email and SMS forms; uses whatever is live right now. */
function TestSend({ channel }: { channel: 'email' | 'sms' }) {
  const { t } = useTranslation();
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async () => {
    if (busy || !to.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      await apiPost(`/admin/settings/${channel}/test`, { to: to.trim() });
      setResult({ ok: true, text: t('admin.settings.testSent', { to: to.trim() }) });
    } catch (err) {
      setResult({ ok: false, text: failureText(err, t) });
    }
    setBusy(false);
  };
  return (
    <Card title={t('admin.settings.testTitle')} intro={t(`admin.settings.testIntro.${channel}`)}>
      <div className={styles.copyRow}>
        <TextField
          className={styles.grow}
          icon={channel === 'email' ? 'mail' : 'phone'}
          label={t(`admin.settings.testTo.${channel}`)}
          type={channel === 'email' ? 'email' : 'tel'}
          placeholder={channel === 'email' ? 'you@example.com' : '+8801712345678'}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <Button variant="secondary" icon="send" loading={busy} disabled={!to.trim()} onClick={() => void send()}>
          {t('admin.settings.sendTest')}
        </Button>
      </div>
      {result && <Alert tone={result.ok ? 'success' : 'danger'}>{result.text}</Alert>}
    </Card>
  );
}

function GoogleCard({ data, store }: { data: AdminSettingsJson['google']; store: Store }) {
  const { t } = useTranslation();
  const s = useSection('google', store);
  const [clientId, setClientId] = useState(data.source === 'admin' ? (data.clientId ?? '') : '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void s.save({ clientId: clientId.trim() });
  };
  return (
    <Card title={t('admin.settings.google.title')} intro={t('admin.settings.google.intro')} source={data.source} guide="google">
      {data.source === 'server' && data.clientId && (
        <div className={styles.statusRow}>
          <span className={styles.muted}>{t('admin.settings.google.serverValue')}</span>
          <code className={styles.account}>{data.clientId}</code>
        </div>
      )}
      <form className={styles.stack} onSubmit={submit} noValidate>
        <TextField
          icon="key"
          label={t('admin.settings.google.clientId')}
          hint={t('admin.settings.google.clientIdHint')}
          autoComplete="off"
          placeholder="1234-abc.apps.googleusercontent.com"
          required
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
        <Footer s={s} source={data.source} label={t('admin.settings.save')} />
      </form>
    </Card>
  );
}

function EmailCard({ data, store, secrets }: { data: AdminSettingsJson['email']; store: Store; secrets: boolean }) {
  const { t } = useTranslation();
  const s = useSection('email', store);
  const smtp = data.smtp;
  const [host, setHost] = useState(smtp?.host ?? '');
  const [port, setPort] = useState(String(smtp?.port ?? 587));
  const [secure, setSecure] = useState(smtp?.secure ?? false);
  const [user, setUser] = useState(smtp?.user ?? '');
  const [password, setPassword] = useState('');
  const [from, setFrom] = useState(smtp?.from ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void s.save({ host: host.trim(), port: Number(port), secure, user: user.trim(), password, from: from.trim() }).then(() => setPassword(''));
  };
  return (
    <Card title={t('admin.settings.email.title')} intro={t('admin.settings.email.intro')} source={data.source} guide="email">
      <form className={styles.stack} onSubmit={submit} noValidate>
        <div className={styles.copyRow}>
          <TextField className={styles.grow} icon="link" label={t('admin.settings.email.host')} placeholder="smtp.gmail.com" autoComplete="off" value={host} onChange={(e) => setHost(e.target.value)} />
          <TextField icon="hash" label={t('admin.settings.email.port')} inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} />
        </div>
        <Checkbox label={t('admin.settings.email.secure')} checked={secure} onChange={setSecure} />
        <TextField icon="person" label={t('admin.settings.email.user')} hint={t('admin.settings.email.userHint')} autoComplete="off" value={user} onChange={(e) => setUser(e.target.value)} />
        <TextField
          icon="lock"
          label={t('admin.settings.email.password')}
          hint={smtp?.passwordSet ? t('admin.settings.keepSecret') : undefined}
          type="password"
          autoComplete="new-password"
          disabled={!secrets}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <TextField icon="at" label={t('admin.settings.email.from')} hint={t('admin.settings.email.fromHint')} placeholder="Slots <no-reply@example.com>" autoComplete="off" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Footer s={s} source={data.source} label={t('admin.settings.save')} />
      </form>
    </Card>
  );
}

function SmsCard({ data, store, secrets }: { data: AdminSettingsJson['sms']; store: Store; secrets: boolean }) {
  const { t } = useTranslation();
  const s = useSection('sms', store);
  const tw = data.twilio;
  const [accountSid, setAccountSid] = useState(tw?.accountSid ?? '');
  const [authToken, setAuthToken] = useState('');
  const [from, setFrom] = useState(tw?.from ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void s.save({ accountSid: accountSid.trim(), authToken: authToken.trim(), from: from.trim() }).then(() => setAuthToken(''));
  };
  return (
    <Card title={t('admin.settings.sms.title')} intro={t('admin.settings.sms.intro')} source={data.source} guide="sms">
      <form className={styles.stack} onSubmit={submit} noValidate>
        <TextField icon="key" label={t('admin.settings.sms.accountSid')} placeholder="AC…" autoComplete="off" value={accountSid} onChange={(e) => setAccountSid(e.target.value)} />
        <TextField
          icon="lock"
          label={t('admin.settings.sms.authToken')}
          hint={tw?.authTokenSet ? t('admin.settings.keepSecret') : undefined}
          type="password"
          autoComplete="new-password"
          disabled={!secrets}
          value={authToken}
          onChange={(e) => setAuthToken(e.target.value)}
        />
        <TextField icon="phone" label={t('admin.settings.sms.from')} hint={t('admin.settings.sms.fromHint')} type="tel" placeholder="+15550001111" autoComplete="off" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Footer s={s} source={data.source} label={t('admin.settings.save')} />
      </form>
    </Card>
  );
}

/** Where to get a Google client ID, with this site's origin to allow. */
function GoogleSteps() {
  const { t } = useTranslation();
  return (
    <Card title={t('admin.settings.google.stepsTitle')} intro={t('admin.settings.google.stepsIntro')}>
      <ol className={styles.steps}>
        <li>
          <a className={styles.link} href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">
            {t('admin.settings.google.step1')}
          </a>
        </li>
        <li>{t('admin.settings.google.step2')}</li>
        <li>
          {t('admin.settings.google.step3')} <code className={styles.account}>{window.location.origin}</code>
        </li>
        <li>{t('admin.settings.google.step4')}</li>
      </ol>
    </Card>
  );
}

const SECTIONS: SettingsTab[] = ['general', 'payments', 'sports', 'google', 'email', 'sms'];

/** Platform settings, one tab each: General (signup, fee), Payments (where owners pay you), Sports (the catalog), then the sign-in and delivery providers. Saved values win over the server env and apply without a restart. */
export function AdminSettingsPage() {
  const { t, i18n } = useTranslation();
  useAdminTitle(t('admin.nav.settings'));
  const res = useResource<AdminSettingsJson>('/admin/settings');
  const [params, setParams] = useSearchParams();
  const tab = SECTIONS.find((x) => x === params.get('section')) ?? 'general';
  const setTab = (id: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id === 'general') next.delete('section');
        else next.set('section', id);
        return next;
      },
      { replace: true },
    );

  if (res.state.status === 'error') {
    return (
      <Alert tone="danger">
        <p className={styles.muted}>{errorMessage(res.state.error, t)}</p>
        <Button variant="secondary" icon="refresh" onClick={res.reload}>
          {t('auth.retry')}
        </Button>
      </Alert>
    );
  }
  if (res.state.status !== 'ready') return <Skeleton kind="detail" label={t('common.loading')} />;
  const data = res.state.data;

  return (
    <div className={styles.page}>
      <div className={styles.stack}>
        <p className={styles.muted}>{t('admin.settings.intro')}</p>
        {data.updatedAt && (
          <p className={styles.muted}>{t('admin.settings.lastChange', { when: dayTime(data.updatedAt, i18n.language), who: data.updatedBy ?? '—' })}</p>
        )}
      </div>
      {!data.secretsAvailable && <Alert tone="warning">{t('admin.settings.noKey')}</Alert>}
      <Tabs label={t('admin.settings.tabs')} tabs={SECTIONS.map((id) => ({ id, label: t(`admin.settings.tab.${id}`) }))} value={tab} onChange={setTab} />
      <div className={styles.layout} role="tabpanel" aria-label={t(`admin.settings.tab.${tab}`)}>
        {tab === 'general' && <GeneralTab data={data} store={res.set} />}
        {tab === 'payments' && <PaymentsTab data={data} store={res.set} />}
        {tab === 'sports' && <SportsTab data={data} store={res.set} />}
        {tab === 'google' && (
          <>
            <GoogleCard data={data.google} store={res.set} />
            <GoogleSteps />
          </>
        )}
        {tab === 'email' && (
          <>
            <EmailCard data={data.email} store={res.set} secrets={data.secretsAvailable} />
            <TestSend channel="email" />
          </>
        )}
        {tab === 'sms' && (
          <>
            <SmsCard data={data.sms} store={res.set} secrets={data.secretsAvailable} />
            <TestSend channel="sms" />
          </>
        )}
      </div>
    </div>
  );
}
