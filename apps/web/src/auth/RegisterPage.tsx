import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { OtpInput } from '../components/ui/OtpInput';
import { PhoneInput } from '../components/ui/PhoneInput';
import { TextField } from '../components/ui/TextField';
import { ApiError, apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import type { AuthResponse, OtpSent } from '../lib/types';
import { AuthLayout } from './AuthLayout';
import { GoogleButton } from './GoogleButton';
import { safeNext } from './safeNext';
import { useAuth } from './useAuth';
import { useCooldown } from './useCooldown';
import styles from './auth.module.css';

/** Which existing account an error points to, so the alert can offer to sign in instead. */
type InUse = 'email' | 'phone' | null;

const inUseOf = (err: unknown): InUse =>
  err instanceof ApiError ? (err.code === 'email_in_use' ? 'email' : err.code === 'phone_in_use' ? 'phone' : null) : null;

/**
 * Same two steps as sign-in: pick Google or phone, then the phone form. `?method=phone` keeps the step so Back works.
 * The number is verified with an SMS code, then the account details are filled in.
 */
export function RegisterPage() {
  const { t } = useTranslation();
  const { status, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rawNext = params.get('next');
  const next = safeNext(rawNext);
  const withPhone = params.get('method') === 'phone';

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const cooldown = useCooldown(60);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; inUse: InUse } | null>(null);

  if (status === 'signedIn') return <Navigate to={next} replace />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError({ message: errorMessage(err, t), inUse: inUseOf(err) });
    } finally {
      setBusy(false);
    }
  };

  const requestCode = (e?: FormEvent) => {
    e?.preventDefault();
    return run(async () => {
      const sent = await apiPost<OtpSent>('/auth/register/otp/request', { phone });
      setCode('');
      setCodeSent(true);
      cooldown.start(sent.resendInSec);
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const res = await apiPost<AuthResponse>('/auth/register', { name, email, password, phone, code });
      signIn(res);
      navigate(next, { replace: true });
    });
  };

  const loginHref = '/login' + (rawNext ? `?next=${encodeURIComponent(rawNext)}` : '');
  const registerHref = (phoneStep: boolean) => {
    const q = new URLSearchParams();
    if (phoneStep) q.set('method', 'phone');
    if (rawNext) q.set('next', rawNext);
    const str = q.toString();
    return '/register' + (str ? `?${str}` : '');
  };

  if (!withPhone) {
    return (
      <AuthLayout variant="register">
        <div className={styles.card}>
          <h1 className={styles.title}>{t('auth.register.title')}</h1>
          <GoogleButton
            text="signup_with"
            onSignedIn={(res) => {
              signIn(res);
              navigate(next, { replace: true });
            }}
          />
          <div className={styles.choices}>
            <Button variant="secondary" size="lg" icon="phone" block to={registerHref(true)}>
              {t('auth.login.withPhone')}
            </Button>
          </div>
          <div className={styles.links}>
            <Link to={loginHref}>{t('auth.register.haveAccount')}</Link>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout variant="register">
      <div className={styles.card}>
        <Button variant="ghost" size="sm" icon="arrowLeft" to={registerHref(false)} className={styles.back}>
          {t('auth.register.otherOptions')}
        </Button>
        <h1 className={styles.title}>{t('auth.register.titlePhone')}</h1>
        {error && (
          <Alert tone="danger">
            {error.message}
            {error.inUse && (
              <>
                {' '}
                <Link to={loginHref}>{t('auth.register.toLogin')}</Link>
              </>
            )}
          </Alert>
        )}

        {!codeSent && (
          <form className={styles.form} onSubmit={requestCode}>
            <p className={styles.sent}>{t('auth.register.phoneFirst')}</p>
            <PhoneInput label={t('auth.phone.label')} value={phone} onChange={setPhone} />
            <Button type="submit" variant="brand" size="lg" icon="send" block loading={busy} disabled={!phone}>
              {t('auth.phone.sendCode')}
            </Button>
          </form>
        )}

        {codeSent && (
          <form className={styles.form} onSubmit={submit}>
            <p className={styles.sent}>{t('auth.phone.sentTo', { phone })}</p>
            <OtpInput label={t('auth.phone.code')} value={code} onChange={setCode} />
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
            <TextField icon="person" label={t('auth.name')} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
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
              autoComplete="new-password"
              required
              minLength={8}
              hint={t('auth.register.passwordHint')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" variant="brand" size="lg" icon="personAdd" block loading={busy} disabled={code.length !== 6}>
              {t('auth.register.submit')}
            </Button>
          </form>
        )}

        <div className={styles.links}>
          <Link to={loginHref}>{t('auth.register.haveAccount')}</Link>
        </div>
      </div>
    </AuthLayout>
  );
}
