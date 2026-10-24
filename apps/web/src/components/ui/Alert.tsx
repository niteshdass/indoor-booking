import type { HTMLAttributes } from 'react';
import type { Tone } from './Badge';
import styles from './Alert.module.css';

export type AlertProps = HTMLAttributes<HTMLDivElement> & { tone: Tone };

export function Alert({ tone, className, role, ...rest }: AlertProps) {
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      className={[styles.alert, styles[tone], className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
