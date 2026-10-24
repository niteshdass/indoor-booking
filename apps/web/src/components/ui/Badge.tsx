import type { HTMLAttributes } from 'react';
import styles from './Badge.module.css';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone: Tone };

export function Badge({ tone, className, ...rest }: BadgeProps) {
  return <span className={[styles.badge, styles[tone], className].filter(Boolean).join(' ')} {...rest} />;
}
