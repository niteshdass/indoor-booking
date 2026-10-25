import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { TextField } from '../components/ui/TextField';
import { apiPatch } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import type { PublicUser } from '../lib/types';
import { useResource } from '../owner/useResource';
import type { OwnerMembership } from '../owner/types';
import { useAuth } from './useAuth';
import styles from './auth.module.css';

export function ProfilePage() {
  const { t } = useTranslation();
  const { user, setUser, signOut } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const teams = useResource<{ memberships: OwnerMembership[] }>('/me/memberships');
  const isMember = teams.state.status === 'ready' && teams.state.data.memberships.length > 0;

  if (!user) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await apiPatch<{ user: PublicUser }>('/me', { name });
      setUser(res.user);
      setName(res.user.name);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    // Leave first: clearing the session while still here would bounce through RequireAuth to /login.
    navigate('/', { replace: true });
    await signOut();
  };

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('profile.title')}</h1>
        {error && <Alert tone="danger">{error}</Alert>}
        {saved && <Alert tone="success">{t('profile.saved')}</Alert>}
        <form className={styles.form} onSubmit={save}>
          <TextField
            label={t('profile.name')}
            autoComplete="name"
            required
            maxLength={80}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
          <Button type="submit" variant="brand" size="lg" block loading={busy} disabled={!name.trim()}>
            {t('profile.save')}
          </Button>
        </form>

        <div className={styles.readonly}>
          <span className={styles.readonlyLabel}>{t('profile.email')}</span>
          <span className={styles.readonlyValue}>
            {user.email ?? t('profile.notSet')}
            {user.email && user.emailVerified && <Badge tone="success">{t('profile.verified')}</Badge>}
          </span>
        </div>
        <div className={styles.readonly}>
          <span className={styles.readonlyLabel}>{t('profile.phone')}</span>
          <span className={styles.readonlyValue}>{user.phone ?? t('profile.notSet')}</span>
        </div>
        {user.hasGoogle && <Badge tone="info">{t('profile.google')}</Badge>}

        {isMember && (
          <Card>
            <Button to="/owner" variant="secondary" size="lg" block>
              {t('owner.portalLink')}
            </Button>
          </Card>
        )}

        <Button variant="secondary" size="lg" block onClick={() => void leave()}>
          {t('profile.signOut')}
        </Button>
      </div>
    </main>
  );
}
