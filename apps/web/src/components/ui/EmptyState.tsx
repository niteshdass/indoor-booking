import type { ReactNode } from 'react';
import type { Sport } from '@booking/shared';
import { SportCourt } from '../../landing/SportCourt';
import styles from './EmptyState.module.css';

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  /** A button or link that gets the list out of its empty state (clear filters, add the first one). */
  action?: ReactNode;
  /** Which court to draw; only the picture changes. */
  sport?: Sport;
  /** `sm` for a section inside a page or card (payments, games); `md` stands in for a whole list. */
  size?: 'md' | 'sm';
  /** Drop the surface card when the empty state already sits inside one. */
  bare?: boolean;
  className?: string;
};

/** Stands in for an empty table or list: a court drawing in chalk lines, a title, an optional hint and action. */
export function EmptyState({ title, description, action, sport = 'tennis', size = 'md', bare = false, className }: EmptyStateProps) {
  return (
    <div className={[styles.empty, styles[size], bare ? styles.bare : '', className].filter(Boolean).join(' ')}>
      <span className={styles.art} aria-hidden="true">
        <SportCourt sport={sport} className={styles.court} />
      </span>
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
