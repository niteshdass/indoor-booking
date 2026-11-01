import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { ApiError, apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import styles from './auth.module.css';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function ResetPasswordPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('auth.reset.title'));
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<{ message: string; invalid: boolean } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost('/auth/password/reset', { token, password });
      setDone(true);
      // Drop the single-use token from the address bar and history.
      navigate('/reset-password', { replace: true });
    } catch (err) {
      setError({ message: errorMessage(err, t), invalid: err instanceof ApiError && err.code === 'invalid_reset_token' });
    } finally {
      setBusy(false);
    }
  };

  const requestNew = <Link to="/forgot-password">{t('auth.reset.requestNew')}</Link>;
  const invalidView = !token || error?.invalid;

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('auth.reset.title')}</h1>
        {done ? (
          <>
            <Alert tone="success">{t('auth.reset.success')}</Alert>
            <div className={styles.links}>
              <Link to="/login">{t('auth.reset.toLogin')}</Link>
            </div>
          </>
        ) : invalidView ? (
          <>
            <Alert tone="danger">{error?.message ?? t('auth.reset.invalid')}</Alert>
            <div className={styles.links}>{requestNew}</div>
          </>
        ) : (
          <>
            {error && <Alert tone="danger">{error.message}</Alert>}
            <form className={styles.form} onSubmit={submit}>
              <TextField
                icon="lock"
                label={t('auth.reset.newPassword')}
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                hint={t('auth.register.passwordHint')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="submit" variant="brand" size="lg" icon="check" block loading={busy}>
                {t('auth.reset.submit')}
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
