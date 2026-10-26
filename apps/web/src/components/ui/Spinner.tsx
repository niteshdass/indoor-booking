import type { HTMLAttributes } from 'react';
import styles from './Spinner.module.css';

export type SpinnerProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & { label: string };

export function Spinner({ label, className, ...rest }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={[styles.spinner, className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
