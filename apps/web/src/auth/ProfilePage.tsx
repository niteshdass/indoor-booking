import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { apiPatch } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { initials } from '../lib/initials';
import type { PublicUser } from '../lib/types';
import { useResource } from '../owner/useResource';
import type { OwnerMembership } from '../owner/types';
import { SignOutDialog } from './SignOutDialog';
import { useAuth } from './useAuth';
import styles from './ProfilePage.module.css';

/** One label-and-value line in the contact card. */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <dt className={styles.rowLabel}>{label}</dt>
      <dd className={styles.rowValue}>{children}</dd>
    </div>
  );
}

export function ProfilePage() {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const portalHint = useId();
  const adminHint = useId();
  const applyHint = useId();
  const teams = useResource<{ memberships: OwnerMembership[] }>('/me/memberships');
  const isMember = teams.state.status === 'ready' && teams.state.data.memberships.length > 0;
  const noTeams = teams.state.status === 'ready' && teams.state.data.memberships.length === 0;

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

  const contact = user.email ?? user.phone;

  return (
    <main className={styles.page}>
      <h1 className={styles.srOnly}>{t('profile.title')}</h1>
      <header className={styles.identity}>
        <span className={styles.avatar} aria-hidden="true">
          {initials(user.name) || '?'}
        </span>
        <div className={styles.identityText}>
          <p className={styles.name}>{user.name}</p>
          {contact && <p className={styles.contact}>{contact}</p>}
        </div>
      </header>

      <section className={styles.card} aria-labelledby="profile-details">
        <h2 id="profile-details" className={styles.cardTitle}>
          {t('profile.details')}
        </h2>
        {error && <Alert tone="danger">{error}</Alert>}
        {saved && <Alert tone="success">{t('profile.saved')}</Alert>}
        <form className={styles.form} onSubmit={save}>
          <div className={styles.field}>
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
          </div>
          <Button
            type="submit"
            size="lg"
            className={styles.save}
            loading={busy}
            disabled={!name.trim() || name.trim() === user.name}
          >
            {t('profile.save')}
          </Button>
        </form>
      </section>

      <section className={styles.card} aria-labelledby="profile-signin">
        <h2 id="profile-signin" className={styles.cardTitle}>
          {t('profile.signInMethods')}
        </h2>
        <dl className={styles.list}>
          <InfoRow label={t('profile.email')}>
            {user.email ? (
              <>
                <span className={styles.value}>{user.email}</span>
                {user.emailVerified ? (
                  <Badge tone="success">{t('profile.verified')}</Badge>
                ) : (
                  <Badge tone="warning">{t('profile.notVerified')}</Badge>
                )}
              </>
            ) : (
              <span className={styles.empty}>{t('profile.notSet')}</span>
            )}
          </InfoRow>
          <InfoRow label={t('profile.phone')}>
            {user.phone ? (
              <span className={styles.value}>{user.phone}</span>
            ) : (
              <span className={styles.empty}>{t('profile.notSet')}</span>
            )}
          </InfoRow>
          {user.hasGoogle && (
            <InfoRow label={t('profile.google')}>
              <Badge tone="info">{t('profile.connected')}</Badge>
            </InfoRow>
          )}
        </dl>
      </section>

      {isMember && (
        <Link to="/owner" className={styles.portal} aria-label={t('owner.portalLink')} aria-describedby={portalHint}>
          <span className={styles.portalIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />
            </svg>
          </span>
          <span className={styles.portalText}>
            <span className={styles.portalTitle}>{t('profile.ownerPortal')}</span>
            <span id={portalHint} className={styles.portalHint}>
              {t('profile.ownerPortalHint')}
            </span>
          </span>
          <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </Link>
      )}

      {noTeams && !user.platformAdmin && (
        <Link to="/list-your-venue" className={styles.portal} aria-describedby={applyHint}>
          <span className={styles.portalIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <span className={styles.portalText}>
            <span className={styles.portalTitle}>{t('profile.listVenue')}</span>
            <span id={applyHint} className={styles.portalHint}>
              {t('profile.listVenueHint')}
            </span>
          </span>
          <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </Link>
      )}

      {user.platformAdmin && (
        <Link to="/admin" className={styles.portal} aria-describedby={adminHint}>
          <span className={styles.portalIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" />
            </svg>
          </span>
          <span className={styles.portalText}>
            <span className={styles.portalTitle}>{t('profile.adminPortal')}</span>
            <span id={adminHint} className={styles.portalHint}>
              {t('profile.adminPortalHint')}
            </span>
          </span>
          <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </Link>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" size="lg" onClick={() => setConfirmOut(true)}>
          <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10" />
          </svg>
          {t('profile.signOut')}
        </Button>
      </div>
      <SignOutDialog open={confirmOut} onClose={() => setConfirmOut(false)} />
    </main>
  );
}
