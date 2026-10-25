import { useId, type SelectHTMLAttributes } from 'react';
import styles from './Select.module.css';

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  label: string;
  size?: 'md' | 'lg';
  /** `inline` puts the label beside the control (toolbars, switchers); `stacked` puts it above, like TextField, for forms. */
  layout?: 'inline' | 'stacked';
  options: { value: string; label: string }[];
};

export function Select({ label, options, size = 'md', layout = 'inline', id, className, ...rest }: SelectProps) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <div className={[styles.field, layout === 'stacked' && styles.stacked, className].filter(Boolean).join(' ')}>
      <label htmlFor={selectId} className={styles.label}>
        {label}
      </label>
      <select id={selectId} className={[styles.select, size === 'lg' && styles.lg].filter(Boolean).join(' ')} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
