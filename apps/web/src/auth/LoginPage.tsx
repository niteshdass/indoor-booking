import { useState, type FormEvent } from 'react';
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
import { AuthLayout } from './AuthLayout';
import { DemoSignIn } from './DemoSignIn';
import { GoogleButton } from './GoogleButton';
import { safeNext } from './safeNext';
import { useAuth } from './useAuth';
import { useCooldown } from './useCooldown';
import styles from './auth.module.css';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Method = 'phone' | 'email';
const asMethod = (v: string | null): Method | null => (v === 'phone' || v === 'email' ? v : null);

/** Two steps: pick a way in (Google, phone or email), then the chosen form. `?method=` keeps the step so Back works. */
export function LoginPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('auth.login.title'));
  const { status, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rawNext = params.get('next');
  const next = safeNext(rawNext);
  const method = asMethod(params.get('method'));

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Errors belong to the step they came from.
  const [errorStep, setErrorStep] = useState(method);
  if (errorStep !== method) {
    setErrorStep(method);
    setError(null);
  }

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

  const loginHref = (m: Method | null) => {
    const q = new URLSearchParams();
    if (m) q.set('method', m);
    if (rawNext) q.set('next', rawNext);
    const s = q.toString();
    return '/login' + (s ? `?${s}` : '');
  };
  const registerHref = '/register' + (rawNext ? `?next=${encodeURIComponent(rawNext)}` : '');

  if (!method) {
    return (
      <AuthLayout variant="login">
        <div className={styles.card}>
          <h1 className={styles.title}>{t('auth.login.title')}</h1>
          <DemoSignIn onSignedIn={finish} />
          <GoogleButton text="signin_with" onSignedIn={finish} />
          <div className={styles.choices}>
            <Button variant="secondary" size="lg" icon="phone" block to={loginHref('phone')}>
              {t('auth.login.withPhone')}
            </Button>
            <Button variant="secondary" size="lg" icon="mail" block to={loginHref('email')}>
              {t('auth.login.withEmail')}
            </Button>
          </div>
          <div className={styles.links}>
            <Link to={registerHref}>{t('auth.login.toRegister')}</Link>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout variant="login">
      <div className={styles.card}>
        <Button variant="ghost" size="sm" icon="arrowLeft" to={loginHref(null)} className={styles.back}>
          {t('auth.login.otherOptions')}
        </Button>
        <h1 className={styles.title}>{t(method === 'phone' ? 'auth.login.titlePhone' : 'auth.login.titleEmail')}</h1>

        {error && <Alert tone="danger">{error}</Alert>}

        {method === 'phone' && !codeSent && (
          <form className={styles.form} onSubmit={requestCode}>
            <PhoneInput label={t('auth.phone.label')} value={phone} onChange={setPhone} />
            <Button type="submit" variant="brand" size="lg" icon="send" block loading={busy} disabled={!phone}>
              {t('auth.phone.sendCode')}
            </Button>
          </form>
        )}

        {method === 'phone' && codeSent && (
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

        {method === 'email' && (
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

        <div className={styles.links}>
          {method === 'email' && <Link to="/forgot-password">{t('auth.login.forgot')}</Link>}
          <Link to={registerHref}>{t('auth.login.toRegister')}</Link>
        </div>
      </div>
    </AuthLayout>
  );
}
