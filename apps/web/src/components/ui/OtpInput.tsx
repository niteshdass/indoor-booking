import { useId, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './OtpInput.module.css';

export type OtpInputProps = {
  value: string;
  onChange(value: string): void;
  length?: number;
  label: string;
  error?: string;
};

const digitsOf = (s: string) => s.replace(/\D/g, '');

export function OtpInput({ value, onChange, length = 6, label, error }: OtpInputProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const errorId = useId();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = value.split('').slice(0, length);

  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  /** Writes `digits` into the code starting at box `at`, then moves focus past them. */
  const write = (at: number, digits: string) => {
    const next = [...chars];
    const start = Math.min(at, next.length);
    for (let k = 0; k < digits.length && start + k < length; k++) next[start + k] = digits[k]!;
    const joined = next.join('');
    if (joined !== value) onChange(joined);
    focus(start + digits.length);
  };

  const onInput = (i: number, raw: string) => {
    if (raw === '') {
      if (i < chars.length) {
        const next = [...chars];
        next.splice(i, 1);
        onChange(next.join(''));
      }
      return;
    }
    const digits = digitsOf(raw);
    if (digits) write(i, digits);
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !chars[i] && i > 0) {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focus(i + 1);
    }
  };

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const digits = digitsOf(e.clipboardData.getData('text'));
    if (!digits) return;
    if (digits.length >= length) {
      onChange(digits.slice(0, length));
      focus(length - 1);
    } else {
      write(i, digits);
    }
  };

  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={error ? errorId : undefined} className={styles.group}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <div className={styles.boxes}>
        {Array.from({ length }, (_, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={[styles.box, error && styles.invalid].filter(Boolean).join(' ')}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            aria-label={t('auth.otp.digit', { n: i + 1, total: length })}
            aria-invalid={error ? true : undefined}
            value={chars[i] ?? ''}
            onChange={(e) => onInput(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={(e) => onPaste(i, e)}
            onFocus={(e) => e.target.select()}
          />
        ))}
      </div>
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
