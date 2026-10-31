import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import styles from './auth.module.css';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost('/auth/password/forgot', { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('auth.forgot.title')}</h1>
        {sent ? (
          <Alert tone="success">{t('auth.forgot.sent')}</Alert>
        ) : (
          <>
            <p className={styles.hint}>{t('auth.forgot.intro')}</p>
            {error && <Alert tone="danger">{error}</Alert>}
            <form className={styles.form} onSubmit={submit}>
              <TextField
                icon="mail"
                label={t('auth.email')}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button type="submit" variant="brand" size="lg" icon="send" block loading={busy}>
                {t('auth.forgot.submit')}
              </Button>
            </form>
          </>
        )}
        <div className={styles.links}>
          <Link to="/login">{t('auth.forgot.back')}</Link>
        </div>
      </div>
    </main>
  );
}
