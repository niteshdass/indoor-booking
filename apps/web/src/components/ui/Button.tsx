import type { ButtonHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from './Spinner';
import styles from './Button.module.css';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'brand' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const { t } = useTranslation();
  const cls = [styles.button, styles[variant], styles[size], block && styles.block, className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner label={t('common.loading')} />}
      {children}
    </button>
  );
}
