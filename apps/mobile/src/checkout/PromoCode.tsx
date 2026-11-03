import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { COUPON_CODE_PATTERN, formatMoney, normalizeCouponCode } from '@booking/shared';
import { ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Field, Text } from '../ui';
import type { QuoteCoupon } from './types';

export interface PromoCodeProps {
  /** The code the current quote applied, if any. */
  applied: QuoteCoupon | null;
  currency: string;
  /** A quote with a newly entered code is on its way. */
  pending: boolean;
  /** Why the last code was refused. */
  error: unknown;
  onApply(code: string): void;
  onRemove(): void;
}

/**
 * "Have a promo code?" disclosure: a code field and Apply, or once applied the code with Remove.
 * Mirrors apps/web/src/checkout/PromoCode.tsx; a code that cannot match the pattern is refused without a request.
 */
export function PromoCode({ applied, currency, pending, error, onApply, onRemove }: PromoCodeProps) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const [open, setOpen] = useState(error !== null && error !== undefined);
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState(false);
  // A refusal belongs to the code that was sent; once the player edits it, the message goes.
  const [edited, setEdited] = useState(false);
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
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.space2 }}>
        <View style={{ paddingHorizontal: t.space3, paddingVertical: t.space1, borderRadius: t.radiusMd, backgroundColor: t.successSoft }}>
          <Text variant="label" weight="semibold" tone="success">
            {`✓ ${applied.code} ${formatMoney(-applied.discount, currency, i18n.language)}`}
          </Text>
        </View>
        <Text variant="caption" tone="muted" accessibilityLiveRegion="polite" style={{ flexGrow: 1 }}>
          {tr('checkout.promo.applied')}
        </Text>
        <Button variant="secondary" label={tr('checkout.promo.remove')} accessibilityLabel={tr('checkout.promo.removeLabel', { code: applied.code })} onPress={onRemove} />
      </View>
    );
  }

  const shown = localError ? new ApiError(400, 'coupon_invalid', '') : edited ? null : error;
  let message: string | null = null;
  if (shown !== null && shown !== undefined) {
    const min = shown instanceof ApiError && shown.code === 'coupon_min_subtotal' ? (shown.details as { minSubtotal?: unknown } | undefined)?.minSubtotal : undefined;
    message = typeof min === 'number' ? tr('checkout.promo.minSubtotal', { amount: formatMoney(min, currency, i18n.language) }) : errorMessage(shown, tr);
  }

  const submit = () => {
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
    <View style={{ gap: t.space2 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr('checkout.promo.toggle')}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={{ minHeight: t.controlLg, flexDirection: 'row', alignItems: 'center', gap: t.space2 }}
      >
        <Text variant="label" weight="semibold" tone="primary">
          {tr('checkout.promo.toggle')}
        </Text>
        <Text variant="label" tone="primary">
          {open ? '▴' : '▾'}
        </Text>
      </Pressable>
      {open ? (
        <View style={{ gap: t.space2 }}>
          <Field
            label={tr('checkout.promo.label')}
            value={text}
            maxLength={32}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={submit}
            error={message ?? undefined}
            onChangeText={(v) => {
              setText(v.toUpperCase());
              setLocalError(false);
              setEdited(true);
            }}
          />
          <View style={{ alignItems: 'flex-start' }}>
            <Button variant="secondary" label={tr('checkout.promo.apply')} loading={pending} disabled={pending || text.trim() === ''} onPress={submit} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
