import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { ApiError, apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import type { AuthResponse } from '../lib/types';
import { GoogleButton } from './GoogleButton';
import { safeNext } from './safeNext';
import { useAuth } from './useAuth';
import styles from './auth.module.css';

export function RegisterPage() {
  const { t } = useTranslation();
  const { status, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rawNext = params.get('next');
  const next = safeNext(rawNext);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; emailInUse: boolean } | null>(null);

  if (status === 'signedIn') return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<AuthResponse>('/auth/register', { name, email, password });
      signIn(res);
      navigate(next, { replace: true });
    } catch (err) {
      setError({ message: errorMessage(err, t), emailInUse: err instanceof ApiError && err.code === 'email_in_use' });
    } finally {
      setBusy(false);
    }
  };

  const loginHref = '/login' + (rawNext ? `?next=${encodeURIComponent(rawNext)}` : '');

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('auth.register.title')}</h1>
        {error && (
          <Alert tone="danger">
            {error.message}
            {error.emailInUse && (
              <>
                {' '}
                <Link to={loginHref}>{t('auth.register.toLogin')}</Link>
              </>
            )}
          </Alert>
        )}
        <form className={styles.form} onSubmit={submit}>
          <TextField label={t('auth.name')} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
          <TextField
            label={t('auth.email')}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label={t('auth.password')}
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            hint={t('auth.register.passwordHint')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" variant="brand" size="lg" block loading={busy}>
            {t('auth.register.submit')}
          </Button>
        </form>
        <GoogleButton
          onSignedIn={(res) => {
            signIn(res);
            navigate(next, { replace: true });
          }}
        />
        <div className={styles.links}>
          <Link to={loginHref}>{t('auth.register.haveAccount')}</Link>
        </div>
      </div>
    </main>
  );
}
