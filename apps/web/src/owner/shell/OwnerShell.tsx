import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/useAuth';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { useOwner } from '../OwnerProvider';
import { NAV, NAV_GROUPS } from './nav';
import { NavIcon } from './NavIcon';
import { OwnerSwitcher } from './OwnerSwitcher';
import styles from './OwnerShell.module.css';

const TitleContext = createContext<(title: string) => void>(() => {});

/** Sets the top bar title for as long as the calling page is mounted. */
export function useOwnerTitle(title: string): void {
  const setTitle = useContext(TitleContext);
  useEffect(() => {
    setTitle(title);
    return () => setTitle('');
  }, [setTitle, title]);
}

const SIDEBAR_ID = 'owner-sidebar';

/** Owner portal layout: sidebar from lg, a drawer below it, and a top bar with the page title. */
export function OwnerShell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { can } = useOwner();
  const { pathname } = useLocation();
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    menu.current?.focus();
  };

  // Following a link closes the drawer. Only restore focus when it was actually open.
  const wasOpen = useRef(false);
  wasOpen.current = open;
  useEffect(() => {
    if (wasOpen.current) {
      setOpen(false);
      menu.current?.focus();
    }
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        setOpen(false);
        menu.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const items = NAV.filter((n) => (n.any ? n.perms.some(can) : n.perms.every(can)));

  return (
    <div className={styles.shell}>
      <aside id={SIDEBAR_ID} className={[styles.sidebar, open && styles.open].filter(Boolean).join(' ')}>
        <OwnerSwitcher />
        <nav aria-label={t('owner.nav.label')} className={styles.nav}>
          {NAV_GROUPS.map((g) => {
            const group = items.filter((n) => n.group === g);
            if (group.length === 0) return null;
            return (
              <div key={g} className={styles.group}>
                <p className={styles.groupLabel}>{t(`owner.nav.groups.${g}`)}</p>
                {group.map((n) => (
                  <NavLink key={n.key} to={n.to} end={n.to === ''} className={({ isActive }) => [styles.link, isActive && styles.active].filter(Boolean).join(' ')}>
                    <NavIcon navKey={n.key} />
                    {t(n.key)}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className={styles.footer}>
          <LanguageSwitcher />
          <ThemeToggle />
          <Link to="/" className={styles.playerLink}>
            {t('owner.nav.playerSite')}
          </Link>
        </div>
      </aside>
      {open && <div className={styles.scrim} onClick={close} aria-hidden="true" />}
      <div className={styles.main}>
        <header className={styles.topbar}>
          <button
            ref={menu}
            type="button"
            className={styles.menuButton}
            aria-label={t('owner.menu')}
            aria-expanded={open}
            aria-controls={SIDEBAR_ID}
            onClick={() => setOpen((o) => !o)}
          >
            <span aria-hidden="true">☰</span>
          </button>
          <h1 className={styles.title}>{title}</h1>
          {user && <span className={styles.userName}>{user.name}</span>}
        </header>
        <main className={styles.content}>
          <TitleContext.Provider value={setTitle}>
            <Outlet />
          </TitleContext.Provider>
        </main>
      </div>
    </div>
  );
}
