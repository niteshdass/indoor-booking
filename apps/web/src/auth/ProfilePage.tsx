import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../components/ui/Icon';
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
import { useDocumentTitle } from '../lib/useDocumentTitle';

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
  useDocumentTitle(t('profile.title'));
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
              icon="person"
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
            icon="check"
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
            <Icon name="venue" />
          </span>
          <span className={styles.portalText}>
            <span className={styles.portalTitle}>{t('profile.ownerPortal')}</span>
            <span id={portalHint} className={styles.portalHint}>
              {t('profile.ownerPortalHint')}
            </span>
          </span>
          <Icon name="chevronRight" className={styles.chevron} />
        </Link>
      )}

      {noTeams && !user.platformAdmin && (
        <Link to="/list-your-venue" className={styles.portal} aria-describedby={applyHint}>
          <span className={styles.portalIcon} aria-hidden="true">
            <Icon name="plus" />
          </span>
          <span className={styles.portalText}>
            <span className={styles.portalTitle}>{t('profile.listVenue')}</span>
            <span id={applyHint} className={styles.portalHint}>
              {t('profile.listVenueHint')}
            </span>
          </span>
          <Icon name="chevronRight" className={styles.chevron} />
        </Link>
      )}

      {user.platformAdmin && (
        <Link to="/admin" className={styles.portal} aria-describedby={adminHint}>
          <span className={styles.portalIcon} aria-hidden="true">
            <Icon name="shield" />
          </span>
          <span className={styles.portalText}>
            <span className={styles.portalTitle}>{t('profile.adminPortal')}</span>
            <span id={adminHint} className={styles.portalHint}>
              {t('profile.adminPortalHint')}
            </span>
          </span>
          <Icon name="chevronRight" className={styles.chevron} />
        </Link>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" size="lg" onClick={() => setConfirmOut(true)}>
          <Icon name="logout" className={styles.icon} />
          {t('profile.signOut')}
        </Button>
      </div>
      <SignOutDialog open={confirmOut} onClose={() => setConfirmOut(false)} />
    </main>
  );
}
