import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { useAuth } from './useAuth';
import styles from './SignOutDialog.module.css';

type Props = { open: boolean; onClose(): void };

/** Asks before signing out; shared by the profile page and the owner portal sidebar. */
export function SignOutDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (!busy) onClose();
  };
  const confirm = async () => {
    setBusy(true);
    // Leave first: clearing the session while still here would bounce through RequireAuth to /login.
    navigate('/', { replace: true });
    await signOut();
  };

  return (
    <Dialog open={open} onClose={close} title={t('profile.signOutConfirm.title')}>
      <div className={styles.body}>
        <p className={styles.text}>{t('profile.signOutConfirm.body')}</p>
        <div className={styles.actions}>
          <Button variant="secondary" disabled={busy} onClick={close}>
            {t('profile.signOutConfirm.cancel')}
          </Button>
          <Button loading={busy} onClick={() => void confirm()}>
            {t('profile.signOut')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
