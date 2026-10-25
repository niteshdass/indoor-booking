import { useId, type KeyboardEvent } from 'react';
import styles from './Tabs.module.css';

export type TabsProps = {
  label: string;
  tabs: { id: string; label: string }[];
  value: string;
  onChange(id: string): void;
};

/** ARIA tablist with roving tabindex; Arrow keys, Home and End move and select. The caller renders the tab panel. */
export function Tabs({ label, tabs, value, onChange }: TabsProps) {
  const base = useId();
  const domId = (id: string) => `${base}-${id}`;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === value);
    let to = -1;
    if (e.key === 'ArrowRight') to = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') to = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = tabs.length - 1;
    if (to < 0) return;
    e.preventDefault();
    const target = tabs[to]!;
    onChange(target.id);
    document.getElementById(domId(target.id))?.focus();
  };

  return (
    <div className={styles.tabs} role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            id={domId(t.id)}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={[styles.tab, active ? styles.tabActive : ''].filter(Boolean).join(' ')}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
