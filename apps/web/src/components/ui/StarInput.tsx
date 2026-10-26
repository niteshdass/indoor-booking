import { useTranslation } from 'react-i18next';
import styles from './StarInput.module.css';

export type StarInputProps = {
  value: number | null;
  onChange(v: number): void;
  name: string;
  legend: string;
};

export function StarInput({ value, onChange, name, legend }: StarInputProps) {
  const { t } = useTranslation();
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.row}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={styles.option}>
            <input
              type="radio"
              className={styles.input}
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
            />
            <span
              className={[styles.glyph, value !== null && n <= value ? styles.on : ''].join(' ')}
              aria-hidden="true"
            >
              {value !== null && n <= value ? '★' : '☆'}
            </span>
            <span className={styles.text}>{t('reviews.starOption', { count: n })}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
