import { useId, type SelectHTMLAttributes } from 'react';
import styles from './Select.module.css';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: { value: string; label: string }[];
};

export function Select({ label, options, id, className, ...rest }: SelectProps) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label htmlFor={selectId} className={styles.label}>
        {label}
      </label>
      <select id={selectId} className={styles.select} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
