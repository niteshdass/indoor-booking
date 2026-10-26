import { Link, NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { ThemeToggle } from '../theme/ThemeToggle';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LogoMark } from './LogoMark';
import styles from './AppShell.module.css';

export function AppShell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          <LogoMark />
          {t('app.name')}
        </Link>
        <nav aria-label={t('nav.label')} className={styles.nav}>
          <NavLink to="/search">{t('nav.findCourt')}</NavLink>
          {user ? (
            <>
              <NavLink to="/me/bookings">{t('nav.myBookings')}</NavLink>
              <NavLink to="/profile">{t('nav.profile')}</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/lookup">{t('nav.lookup')}</NavLink>
              <NavLink to="/login">{t('nav.signIn')}</NavLink>
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
