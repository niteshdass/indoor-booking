import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { AdminOverviewJson } from '@booking/shared';
import { SignOutDialog } from '../auth/SignOutDialog';
import { useAuth } from '../auth/useAuth';
import { LanguageMenu } from '../components/LanguageSwitcher';
import { initials } from '../lib/initials';
import { NavIcon } from '../owner/shell/NavIcon';
import styles from '../owner/shell/OwnerShell.module.css';
import { useResource } from '../owner/useResource';
import { ThemeMenu } from '../theme/ThemeToggle';
import { useAdmin } from './AdminProvider';
import { ADMIN_NAV } from './nav';

const TitleContext = createContext<(title: string) => void>(() => {});

/** Sets the top bar title for as long as the calling page is mounted. */
export function useAdminTitle(title: string): void {
  const setTitle = useContext(TitleContext);
  useEffect(() => {
    setTitle(title);
    return () => setTitle('');
  }, [setTitle, title]);
}

const SIDEBAR_ID = 'admin-sidebar';

/** Waiting owners and open flags for the nav pills; refreshed on every page change so actions show up at once. */
function useCounts(pathname: string): { owners: number; reviews: number } | null {
  const { state, reload } = useResource<AdminOverviewJson>('/admin/overview');
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reload();
  }, [pathname, reload]);
  if (state.status !== 'ready') return null;
  return { owners: state.data.owners.pending_approval, reviews: state.data.openFlags };
}

/** Platform admin layout: the owner portal's shell (sidebar, drawer, top bar) with the admin nav. */
export function AdminShell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { role } = useAdmin();
  const { pathname } = useLocation();
  const counts = useCounts(pathname);
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
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

  const pill = (to: string) => {
    const n = to === 'owners' ? counts?.owners : to === 'reviews' ? counts?.reviews : undefined;
    if (!n) return null;
    return (
      <span className={styles.count}>
        <span aria-hidden="true">{n}</span>
        <span className={styles.srOnly}>, {t(to === 'owners' ? 'admin.shell.ownersWaiting' : 'admin.shell.flagsOpen', { count: n })}</span>
      </span>
    );
  };

  return (
    <div className={styles.shell}>
      <aside id={SIDEBAR_ID} className={[styles.sidebar, open && styles.open].filter(Boolean).join(' ')}>
        <div className={styles.switcher}>
          <div className={[styles.switcherButton, styles.static].join(' ')}>
            <span className={styles.orgMark} aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false" className={styles.icon}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </span>
            <span className={styles.switcherText}>
              <span className={styles.switcherName}>{t('admin.portal')}</span>
              <span className={styles.switcherRole}>{role.key ? t(`admin.role.${role.key}`, { defaultValue: role.name }) : role.name}</span>
            </span>
          </div>
        </div>
        <nav aria-label={t('admin.nav.label')} className={styles.nav}>
          <div className={styles.group}>
            {ADMIN_NAV.map((n) =>
              'external' in n ? (
                <a key={n.key} href={`/admin/${n.to}`} target="_blank" rel="noopener" className={styles.link}>
                  <NavIcon navKey={n.icon} />
                  {t(n.key)}
                  <svg className={styles.linkTrail} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M7 17 17 7M8 7h9v9" />
                  </svg>
                  <span className={styles.srOnly}>, {t('admin.docs.newTab')}</span>
                </a>
              ) : (
              <NavLink key={n.key} to={n.to ? `/admin/${n.to}` : '/admin'} end={n.to === ''} className={({ isActive }) => [styles.link, isActive && styles.active].filter(Boolean).join(' ')}>
                <NavIcon navKey={n.icon} />
                {t(n.key)}
                {pill(n.to)}
              </NavLink>
              ),
            )}
          </div>
        </nav>
        <div className={styles.footer}>
          <Link to="/" className={styles.link}>
            <NavIcon navKey="playerSite" />
            {t('owner.nav.playerSite')}
            <svg className={styles.linkTrail} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M7 17 17 7M8 7h9v9" />
            </svg>
          </Link>
          {user && (
            <div className={styles.account}>
              <Link to="/profile" className={styles.profile}>
                <span className={styles.avatar} aria-hidden="true">
                  {initials(user.name)}
                </span>
                <span className={styles.accountName}>{user.name}</span>
              </Link>
              <button type="button" className={styles.signOut} aria-label={t('profile.signOut')} title={t('profile.signOut')} onClick={() => setConfirmOut(true)}>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </aside>
      <SignOutDialog open={confirmOut} onClose={() => setConfirmOut(false)} />
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
          <div className={styles.tools}>
            <LanguageMenu />
            <ThemeMenu />
          </div>
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
