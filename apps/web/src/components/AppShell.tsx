import { Link, NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { ThemeMenu } from '../theme/ThemeToggle';
import { LanguageMenu } from './LanguageSwitcher';
import { LogoMark } from './LogoMark';
import { Button } from './ui/Button';
import styles from './AppShell.module.css';

/** Up to two initials for the profile button. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function AppShell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          <LogoMark />
          <span className={styles.brandName}>{t('app.name')}</span>
        </Link>
        <nav aria-label={t('nav.label')} className={styles.nav}>
          <NavLink to="/search">{t('nav.findCourt')}</NavLink>
          {user ? (
            <NavLink to="/me/bookings">{t('nav.myBookings')}</NavLink>
          ) : (
            <NavLink to="/lookup">{t('nav.lookup')}</NavLink>
          )}
        </nav>
        <div className={styles.end}>
          <LanguageMenu />
          <ThemeMenu />
          {user ? (
            <NavLink
              to="/profile"
              className={styles.avatar}
              aria-label={t('nav.profile')}
              title={user.name}
            >
              <span aria-hidden="true">{initials(user.name) || '?'}</span>
            </NavLink>
          ) : (
            <Button to="/login" variant="brand" size="md" className={styles.signIn}>
              {t('nav.signIn')}
            </Button>
          )}
        </div>
      </header>
      <Outlet />
    </div>
  );
}
