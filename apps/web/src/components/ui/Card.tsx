import type { HTMLAttributes } from 'react';
import type { Tone } from './Badge';
import styles from './Card.module.css';

export type CardProps = HTMLAttributes<HTMLDivElement> & { tone?: Tone };

export function Card({ tone = 'neutral', className, role, ...rest }: CardProps) {
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : undefined)}
      className={[styles.card, styles[tone], className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
