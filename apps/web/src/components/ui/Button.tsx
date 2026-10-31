import type { ButtonHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';
import styles from './Button.module.css';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'brand' | 'secondary' | 'ghost' | 'danger' | 'ball';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  /** Glyph before the label; the spinner takes its place while loading. */
  icon?: IconName;
  /** Renders a router link with the same look instead of a button. */
  to?: string;
};

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  icon,
  disabled,
  className,
  children,
  type = 'button',
  to,
  ...rest
}: ButtonProps) {
  const { t } = useTranslation();
  const cls = [styles.button, styles[variant], styles[size], block && styles.block, className]
    .filter(Boolean)
    .join(' ');
  if (to !== undefined) {
    return (
      <Link to={to} className={cls}>
        {icon && <Icon name={icon} className={styles.icon} />}
        {children}
      </Link>
    );
  }
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner label={t('common.loading')} /> : icon && <Icon name={icon} className={styles.icon} />}
      {children}
    </button>
  );
}
