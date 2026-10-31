import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { OtpInput } from '../components/ui/OtpInput';
import { PhoneInput } from '../components/ui/PhoneInput';
import { TextField } from '../components/ui/TextField';
import { apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import type { AuthResponse, OtpSent } from '../lib/types';
import { GoogleButton } from './GoogleButton';
import { safeNext } from './safeNext';
import { useAuth } from './useAuth';
import { useCooldown } from './useCooldown';
import styles from './auth.module.css';

type Tab = 'phone' | 'email';
const TABS: Tab[] = ['phone', 'email'];

export function LoginPage() {
  const { t } = useTranslation();
  const { status, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rawNext = params.get('next');
  const next = safeNext(rawNext);

  const [tab, setTab] = useState<Tab>('phone');
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ phone: null, email: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const cooldown = useCooldown(60);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (status === 'signedIn') return <Navigate to={next} replace />;

  const finish = (res: AuthResponse) => {
    signIn(res);
    navigate(next, { replace: true });
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const requestCode = (e?: FormEvent) => {
    e?.preventDefault();
    return run(async () => {
      const sent = await apiPost<OtpSent>('/auth/otp/request', { phone });
      setCode('');
      setCodeSent(true);
      cooldown.start(sent.resendInSec);
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => finish(await apiPost<AuthResponse>('/auth/otp/verify', { phone, code })));
  };

  const emailLogin = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => finish(await apiPost<AuthResponse>('/auth/login', { email, password })));
  };

  const selectTab = (next: Tab) => {
    setTab(next);
    setError(null);
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const other = tab === 'phone' ? 'email' : 'phone';
    selectTab(other);
    tabRefs.current[other]?.focus();
  };

  const registerHref = '/register' + (rawNext ? `?next=${encodeURIComponent(rawNext)}` : '');

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('auth.login.title')}</h1>

        <div role="tablist" aria-label={t('auth.tabs.label')} className={styles.tabs}>
          {TABS.map((id) => (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[id] = el;
              }}
              type="button"
              role="tab"
              id={`login-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`login-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              className={styles.tab}
              onClick={() => selectTab(id)}
              onKeyDown={onTabKey}
            >
              {t(`auth.tabs.${id}`)}
            </button>
          ))}
        </div>

        {error && <Alert tone="danger">{error}</Alert>}

        <div role="tabpanel" id={`login-panel-${tab}`} aria-labelledby={`login-tab-${tab}`} className={styles.panel}>
          {tab === 'phone' && !codeSent && (
            <form className={styles.form} onSubmit={requestCode}>
              <PhoneInput label={t('auth.phone.label')} value={phone} onChange={setPhone} />
              <Button type="submit" variant="brand" size="lg" icon="send" block loading={busy} disabled={!phone}>
                {t('auth.phone.sendCode')}
              </Button>
            </form>
          )}

          {tab === 'phone' && codeSent && (
            <form className={styles.form} onSubmit={verify}>
              <p className={styles.sent}>{t('auth.phone.sentTo', { phone })}</p>
              <OtpInput label={t('auth.phone.code')} value={code} onChange={setCode} />
              <Button type="submit" variant="brand" size="lg" icon="check" block loading={busy} disabled={code.length !== 6}>
                {t('auth.phone.verify')}
              </Button>
              <div className={styles.row}>
                <Button variant="secondary" size="lg" icon="send" disabled={cooldown.left > 0 || busy} onClick={() => void requestCode()}>
                  {cooldown.left > 0 ? (
                    <span className={styles.countdown}>{t('auth.phone.resendIn', { sec: cooldown.left })}</span>
                  ) : (
                    t('auth.phone.resend')
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  icon="edit"
                  onClick={() => {
                    setCodeSent(false);
                    setCode('');
                    setError(null);
                  }}
                >
                  {t('auth.phone.change')}
                </Button>
              </div>
            </form>
          )}

          {tab === 'email' && (
            <form className={styles.form} onSubmit={emailLogin}>
              <TextField
                icon="mail"
                label={t('auth.email')}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <TextField
                icon="lock"
                label={t('auth.password')}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="submit" variant="brand" size="lg" icon="login" block loading={busy}>
                {t('auth.login.submit')}
              </Button>
            </form>
          )}
        </div>

        <GoogleButton onSignedIn={finish} />

        <div className={styles.links}>
          <Link to="/forgot-password">{t('auth.login.forgot')}</Link>
          <Link to={registerHref}>{t('auth.login.toRegister')}</Link>
        </div>
      </div>
    </main>
  );
}
