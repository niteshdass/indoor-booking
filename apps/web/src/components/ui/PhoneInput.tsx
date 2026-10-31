import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from './Select';
import { TextField } from './TextField';
import styles from './PhoneInput.module.css';

export const DIAL_CODES = [
  { code: 'BD', dial: '+880' },
  { code: 'RU', dial: '+7' },
  { code: 'IN', dial: '+91' },
  { code: 'GB', dial: '+44' },
  { code: 'US', dial: '+1' },
  { code: 'AE', dial: '+971' },
] as const;

const DEFAULT_DIAL = '+880';

export type PhoneInputProps = {
  /** E.164 string, e.g. '+8801712345678'; '' while the number part is empty. */
  value: string;
  onChange(value: string): void;
  label: string;
  error?: string;
};

function dialOf(value: string): string {
  const hit = [...DIAL_CODES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((d) => value.startsWith(d.dial));
  return hit?.dial ?? DEFAULT_DIAL;
}

export function PhoneInput({ value, onChange, label, error }: PhoneInputProps) {
  const { t, i18n } = useTranslation();
  const [dial, setDial] = useState(() => dialOf(value));
  const national = value.startsWith(dial) ? value.slice(dial.length) : '';
  const labelId = useId();

  const options = useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([i18n.language], { type: 'region' });
    } catch {
      names = null;
    }
    return DIAL_CODES.map((d) => ({
      value: d.dial,
      label: `${names?.of(d.code) ?? d.code} (${d.dial})`,
    }));
  }, [i18n.language]);

  const emit = (d: string, digits: string) => onChange(digits ? d + digits : '');

  return (
    <div role="group" aria-labelledby={labelId} className={styles.root}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <div className={styles.row}>
        <Select
          size="lg"
          className={styles.country}
          label={t('auth.phone.country')}
          options={options}
          value={dial}
          onChange={(e) => {
            setDial(e.target.value);
            emit(e.target.value, national);
          }}
        />
        <TextField
          icon="phone"
          className={styles.number}
          label={t('auth.phone.number')}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={national}
          error={error}
          onChange={(e) => emit(dial, e.target.value.replace(/\D/g, ''))}
        />
      </div>
    </div>
  );
}
