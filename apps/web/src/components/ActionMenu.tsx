import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import styles from './HeaderMenu.module.css';
import own from './ActionMenu.module.css';

export type ActionMenuItem = { key: string; label: string; tone?: 'danger'; onSelect: () => void };

type Props = {
  /** Accessible name of the trigger and the menu ("More actions"). */
  label: string;
  items: ActionMenuItem[];
};

/** "⋮" button that opens a small menu of actions under it, for actions that should not sit on the page openly. */
export function ActionMenu({ label, items }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    refs.current[0]?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const list = refs.current.filter((el): el is HTMLButtonElement => el !== null);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (i: number) => list[(i + list.length) % list.length]?.focus({ preventScroll: true });
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(list.length - 1);
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') setOpen(false);
    else return;
    if (e.key !== 'Tab') e.preventDefault();
  };

  return (
    <div ref={root} className={styles.root}>
      <button
        ref={trigger}
        type="button"
        className={own.trigger}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <svg className={styles.glyph} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 5h.01M12 12h.01M12 19h.01" className={own.dots} />
        </svg>
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={label} className={styles.menu} onKeyDown={onMenuKey}>
          {items.map((item, i) => (
            <button
              key={item.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={[styles.item, item.tone === 'danger' ? own.danger : ''].filter(Boolean).join(' ')}
              onClick={() => {
                // Focus goes back to the trigger first, so a dialog the action opens returns focus there.
                close();
                item.onSelect();
              }}
            >
              <span className={styles.itemLabel}>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
