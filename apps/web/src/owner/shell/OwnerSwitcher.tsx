import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/Badge';
import { useOwner } from '../OwnerProvider';
import styles from './OwnerShell.module.css';

/** Sidebar header: shows the current team and role, and lists every membership to switch between. */
export function OwnerSwitcher() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { owner, membership, memberships, ownerId } = useOwner();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); // tells the drawer's Escape handler this press is already handled
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const pick = (id: string) => {
    setOpen(false);
    if (id !== ownerId) void navigate(`/owner/${id}`);
  };

  return (
    <div className={styles.switcher} ref={root}>
      <button
        ref={button}
        type="button"
        className={styles.switcherButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.switcherName}>{owner.name}</span>
        <span className={styles.switcherRole}>{membership.role.name}</span>
      </button>
      {open && (
        <ul id={listId} role="listbox" aria-label={t('owner.switcher')} className={styles.switcherList}>
          {memberships.map((m) => (
            <li
              key={m.ownerId}
              role="option"
              aria-selected={m.ownerId === ownerId}
              tabIndex={0}
              className={styles.switcherOption}
              onClick={() => pick(m.ownerId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  pick(m.ownerId);
                }
              }}
            >
              <span className={styles.switcherName}>{m.ownerName}</span>
              <span className={styles.switcherRole}>{m.role.name}</span>
              {m.ownerStatus !== 'active' && <Badge tone="neutral">{t(`owner.status.${m.ownerStatus}`)}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
