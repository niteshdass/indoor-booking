import type { TableHTMLAttributes } from 'react';
import styles from './Table.module.css';

export type TableProps = TableHTMLAttributes<HTMLTableElement> & { caption: string };

/** Design-system table: sentence-case muted headers, 52px rows. Pass `<thead>`/`<tbody>` as children; the caption is read by screen readers only. */
export function Table({ caption, className, children, ...rest }: TableProps) {
  return (
    <div className={styles.scroll}>
      <table className={[styles.table, className].filter(Boolean).join(' ')} {...rest}>
        <caption className={styles.caption}>{caption}</caption>
        {children}
      </table>
    </div>
  );
}
