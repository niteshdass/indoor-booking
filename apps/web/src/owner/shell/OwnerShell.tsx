import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/useAuth';
import { LanguageMenu } from '../../components/LanguageSwitcher';
import { Button } from '../../components/ui/Button';
import { ThemeMenu } from '../../theme/ThemeToggle';
import type { SeriesJson } from '@booking/shared';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useResource } from '../useResource';
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Weekly booking requests waiting for a reply across the team's venues; refreshed on every page change. */
function useOpenRequests(enabled: boolean, pathname: string): { count: number; more: boolean } | null {
  const { ownerId } = useOwner();
  const { state, reload } = useResource<{ series: SeriesJson[]; nextBefore: string | null }>(
    enabled ? ownerPath(ownerId, '/series?status=requested') : null,
  );
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (enabled) reload();
  }, [pathname, enabled, reload]);
  if (state.status !== 'ready' || state.data.series.length === 0) return null;
  return { count: state.data.series.length, more: state.data.nextBefore !== null };
}

/** Owner portal layout: sidebar from lg, a drawer below it, and a top bar with the page title. */
export function OwnerShell() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { can } = useOwner();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const venueParam = new URLSearchParams(search).get('venue');
  const requests = useOpenRequests(can('booking.view'), pathname);
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

  const leave = async () => {
    // Leave first: clearing the session while still here would bounce through RequireAuth to /login.
    navigate('/', { replace: true });
    await signOut();
  };

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
                    {n.to === 'series' && requests && (
                      <span className={styles.count}>
                        <span aria-hidden="true">{requests.more ? `${requests.count}+` : requests.count}</span>
                        <span className={styles.srOnly}>, {t('owner.shell.seriesWaiting', { count: requests.count })}</span>
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}
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
              <button type="button" className={styles.signOut} aria-label={t('profile.signOut')} title={t('profile.signOut')} onClick={() => void leave()}>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10" />
                </svg>
              </button>
            </div>
          )}
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
          {can('booking.create') && !pathname.endsWith('/walk-in') && (
            <Button to={venueParam ? `walk-in?venue=${encodeURIComponent(venueParam)}` : 'walk-in'} size="sm" className={styles.topAction}>
              {t('owner.shell.newWalkIn')}
            </Button>
          )}
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
