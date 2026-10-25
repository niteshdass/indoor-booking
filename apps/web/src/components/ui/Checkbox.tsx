import { useId, type InputHTMLAttributes } from 'react';
import styles from './Checkbox.module.css';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange'> & {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  hint?: string;
};

export function Checkbox({ label, checked, onChange, hint, id, className, ...rest }: CheckboxProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <input
        {...rest}
        id={inputId}
        type="checkbox"
        className={styles.input}
        checked={checked}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className={styles.text}>
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
        {hint && (
          <p id={hintId} className={styles.hint}>
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
