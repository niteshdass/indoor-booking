import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { useCooldown } from '../auth/useCooldown';
import { apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import type { OtpSent, PublicUser } from '../lib/types';
import { Button } from './ui/Button';
import { OtpInput } from './ui/OtpInput';
import styles from './EmailVerifyNotice.module.css';

const laterKey = (userId: string) => `emailVerifyLater:${userId}`;

function isLater(userId: string): boolean {
  try {
    return sessionStorage.getItem(laterKey(userId)) === '1';
  } catch {
    return false;
  }
}

/**
 * Shown to a signed-in user whose email is not verified: mails a 6-digit code and checks it in place.
 * "Later" hides it for the rest of the browser session.
 */
export function EmailVerifyNotice({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [hidden, setHidden] = useState(false);
  const cooldown = useCooldown(60);

  if (!user || hidden) return null;
  const cls = [styles.notice, done && styles.done, className].filter(Boolean).join(' ');

  if (done) {
    return (
      <div role="status" className={cls}>
        <p className={styles.message}>{t('verifyEmail.done')}</p>
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={() => setHidden(true)}>
            {t('verifyEmail.dismiss')}
          </Button>
        </div>
      </div>
    );
  }
  if (!user.email || user.emailVerified || isLater(user.id)) return null;

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

  const send = () =>
    run(async () => {
      const res = await apiPost<OtpSent>('/me/email/verify/request', {});
      setCode('');
      setSent(true);
      cooldown.start(res.resendInSec);
    });

  const verify = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const res = await apiPost<{ user: PublicUser }>('/me/email/verify', { code });
      setDone(true);
      setUser(res.user);
    });
  };

  const later = () => {
    try {
      sessionStorage.setItem(laterKey(user.id), '1');
    } catch {
      // Storage blocked: hide for this page view only.
    }
    setHidden(true);
  };

  return (
    <section aria-label={t('verifyEmail.label')} className={cls}>
      <p className={styles.message}>
        {sent ? t('verifyEmail.sentTo', { email: user.email }) : t('verifyEmail.message', { email: user.email })}
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!sent ? (
        <div className={styles.actions}>
          <Button variant="primary" size="sm" loading={busy} onClick={() => void send()}>
            {t('verifyEmail.send')}
          </Button>
          <Button variant="ghost" size="sm" onClick={later}>
            {t('verifyEmail.later')}
          </Button>
        </div>
      ) : (
        <form className={styles.form} onSubmit={verify}>
          <OtpInput label={t('verifyEmail.code')} value={code} onChange={setCode} />
          <div className={styles.actions}>
            <Button type="submit" variant="primary" size="sm" loading={busy} disabled={code.length !== 6}>
              {t('verifyEmail.verify')}
            </Button>
            <Button variant="secondary" size="sm" disabled={cooldown.left > 0 || busy} onClick={() => void send()}>
              {cooldown.left > 0 ? (
                <span className={styles.countdown}>{t('auth.phone.resendIn', { sec: cooldown.left })}</span>
              ) : (
                t('auth.phone.resend')
              )}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
