import { Link, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { ThemeToggle } from '../theme/ThemeToggle';
import { LanguageSwitcher } from './LanguageSwitcher';
import styles from './AppShell.module.css';

export function AppShell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          {t('app.name')}
        </Link>
        <nav aria-label={t('nav.label')} className={styles.nav}>
          {user ? (
            <>
              <Link to="/me/bookings">{t('nav.myBookings')}</Link>
              <Link to="/profile">{t('nav.profile')}</Link>
            </>
          ) : (
            <>
              <Link to="/lookup">{t('nav.lookup')}</Link>
              <Link to="/login">{t('nav.signIn')}</Link>
            </>
          )}
        </nav>
        <div className={styles.prefs}>
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <Outlet />
    </div>
  );
}
