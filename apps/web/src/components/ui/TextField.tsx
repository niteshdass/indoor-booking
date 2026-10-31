import { useId, type InputHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './TextField.module.css';

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
  /** Muted glyph at the start of the field that says what goes in it. */
  icon?: IconName;
};

export function TextField({ label, error, hint, icon, id, className, ...rest }: TextFieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <span className={styles.control}>
        {icon && <Icon name={icon} className={styles.icon} />}
        <input
          id={inputId}
          className={[styles.input, icon && styles.withIcon].filter(Boolean).join(' ')}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
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
