import { useId, type SelectHTMLAttributes } from 'react';
import styles from './Select.module.css';

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  label: string;
  size?: 'md' | 'lg';
  /** `inline` puts the label beside the control (toolbars, switchers); `stacked` puts it above, like TextField, for forms. */
  layout?: 'inline' | 'stacked';
  /** Keep the label for screen readers only, when the options already say what the control is (header switchers). */
  hideLabel?: boolean;
  options: { value: string; label: string }[];
  /** Muted line under a stacked select. */
  hint?: string;
  error?: string;
};

export function Select({
  label,
  options,
  size = 'md',
  layout = 'inline',
  hideLabel = false,
  hint,
  error,
  id,
  className,
  ...rest
}: SelectProps) {
  const auto = useId();
  const selectId = id ?? auto;
  const hintId = `${selectId}-hint`;
  const errorId = `${selectId}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div
      className={[styles.field, layout === 'stacked' && styles.stacked, className]
        .filter(Boolean)
        .join(' ')}
    >
      <label htmlFor={selectId} className={hideLabel ? styles.srOnly : styles.label}>
        {label}
      </label>
      <span className={styles.control}>
        <select
          id={selectId}
          className={[styles.select, size === 'lg' && styles.lg].filter(Boolean).join(' ')}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
