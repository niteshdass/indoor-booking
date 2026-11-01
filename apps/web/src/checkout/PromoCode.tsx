import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { COUPON_CODE_PATTERN, normalizeCouponCode } from '@booking/shared';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { ApiError } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { money } from '../lib/format';
import type { QuoteCoupon } from '../lib/types';
import styles from './PromoCode.module.css';

/** A refusal of the code itself: shown under the field, the rest of the checkout carries on. */
export function isCouponError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code.startsWith('coupon_');
}

type Props = {
  /** The code the current quote applied, if any. */
  applied: QuoteCoupon | null;
  currency: string;
  /** True while a quote with a newly entered code is on its way. */
  pending: boolean;
  /** Why the last code was refused; shown under the field. */
  error: unknown;
  onApply(code: string): void;
  onRemove(): void;
};

/**
 * "Have a promo code?" disclosure in the summary card: a code field and Apply, or once applied the code as a
 * chip with Remove. A code that cannot match the pattern is refused here without a request.
 */
export function PromoCode({ applied, currency, pending, error, onApply, onRemove }: Props) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(error !== null && error !== undefined);
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState(false);
  // A refusal belongs to the code that was sent; once the player edits it, the message goes.
  const [edited, setEdited] = useState(false);
  // A new refusal (also one for a code that was already applied) opens the field so its reason shows.
  const [seen, setSeen] = useState(error);
  if (error !== seen) {
    setSeen(error);
    if (error !== null && error !== undefined) {
      setOpen(true);
      setEdited(false);
    }
  }

  if (applied) {
    return (
      <div className={styles.applied}>
        <span className={styles.chip}>
          <Icon name="tag" className={styles.chipIcon} />
          <span className={styles.code}>{applied.code}</span>
          <span className={styles.saved}>{money(-applied.discount, currency, i18n.language)}</span>
        </span>
        <span className={styles.note} role="status">
          {t('checkout.promo.applied')}
        </span>
        <Button variant="secondary" size="sm" aria-label={t('checkout.promo.removeLabel', { code: applied.code })} onClick={onRemove}>
          {t('checkout.promo.remove')}
        </Button>
      </div>
    );
  }

  const shown = localError ? new ApiError(400, 'coupon_invalid', '') : edited ? null : error;
  let message: string | null = null;
  if (shown !== null && shown !== undefined) {
    const min = shown instanceof ApiError && shown.code === 'coupon_min_subtotal' ? (shown.details as { minSubtotal?: unknown } | undefined)?.minSubtotal : undefined;
    message = typeof min === 'number' ? t('checkout.promo.minSubtotal', { amount: money(min, currency, i18n.language) }) : errorMessage(shown, t);
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = normalizeCouponCode(text);
    if (code === '') return;
    if (!COUPON_CODE_PATTERN.test(code)) {
      setLocalError(true);
      return;
    }
    setLocalError(false);
    setEdited(false);
    onApply(code);
  };

  return (
    <div className={styles.promo}>
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen((o) => !o)}>
        <Icon name="tag" className={styles.toggleIcon} />
        {t('checkout.promo.toggle')}
        <Icon name={open ? 'chevronUp' : 'chevronDown'} className={styles.toggleIcon} />
      </button>
      {open && (
        <form id={`${id}-panel`} className={styles.form} onSubmit={submit} noValidate>
          <label htmlFor={`${id}-code`} className={styles.label}>
            {t('checkout.promo.label')}
          </label>
          <div className={styles.row}>
            <input
              id={`${id}-code`}
              className={styles.input}
              value={text}
              maxLength={32}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={message ? true : undefined}
              aria-describedby={message ? `${id}-error` : undefined}
              onChange={(e) => {
                setText(e.target.value.toUpperCase());
                setLocalError(false);
                setEdited(true);
              }}
            />
            <Button type="submit" variant="secondary" loading={pending} disabled={pending || text.trim() === ''}>
              {t('checkout.promo.apply')}
            </Button>
          </div>
          {message && (
            <p id={`${id}-error`} className={styles.error} role="alert">
              {message}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
