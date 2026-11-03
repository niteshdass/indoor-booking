import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { COUPON_CODE_PATTERN, formatMoney, normalizeCouponCode } from '@booking/shared';
import { ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Icon, Text } from '../ui';
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
  /** The code cannot change (e.g. while a booking may still be going through). */
  disabled?: boolean;
}

/**
 * Always open: a tag-icon code field with Apply beside it, or once applied a success row with the code, the saving and
 * Remove. Same rules as apps/web/src/checkout/PromoCode.tsx; a code that cannot match the pattern is refused without a request.
 */
export function PromoCode({ applied, currency, pending, error, onApply, onRemove, disabled = false }: PromoCodeProps) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState(false);
  // A refusal belongs to the code that was sent; once the player edits it, the message goes.
  const [edited, setEdited] = useState(false);
  const [seen, setSeen] = useState(error);
  if (error !== seen) {
    setSeen(error);
    if (error !== null && error !== undefined) setEdited(false);
  }

  if (applied) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space3,
          paddingLeft: t.space3,
          paddingVertical: t.space1,
          borderRadius: t.radiusMd,
          backgroundColor: t.successSoft,
        }}
      >
        <Icon name="tag" color={t.success} />
        <View style={{ flex: 1 }} accessibilityLiveRegion="polite">
          <Text variant="label" weight="bold" tone="success">
            {applied.code}
          </Text>
          <Text variant="caption" tone="success">
            {`${tr('checkout.promo.applied')} · ${formatMoney(-applied.discount, currency, i18n.language)}`}
          </Text>
        </View>
        <Button
          variant="ghost"
          label={tr('checkout.promo.remove')}
          accessibilityLabel={tr('checkout.promo.removeLabel', { code: applied.code })}
          disabled={disabled}
          onPress={onRemove}
        />
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
    if (disabled || code === '') return;
    if (!COUPON_CODE_PATTERN.test(code)) {
      setLocalError(true);
      return;
    }
    setLocalError(false);
    setEdited(false);
    onApply(code);
  };

  return (
    <View style={{ gap: t.space1 }}>
      {/* Stretch so Apply matches the field, whose focus border adds to its height. */}
      <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: t.space2 }}>
        <View
          style={{
            flex: 1,
            minHeight: t.controlLg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.space2,
            paddingLeft: t.space3,
            borderRadius: t.radiusMd,
            borderWidth: t.focusWidth,
            borderColor: message ? t.danger : focused ? t.primary : 'transparent',
            backgroundColor: t.controlFill,
            opacity: disabled ? t.opacityMuted : 1,
          }}
        >
          <Icon name="tag" color={t.textMuted} />
          <TextInput
            accessibilityLabel={tr('checkout.promo.label')}
            accessibilityHint={message ?? undefined}
            placeholder={tr('checkout.promo.placeholder')}
            placeholderTextColor={t.textSubtle}
            value={text}
            maxLength={32}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect={false}
            returnKeyType="done"
            editable={!disabled}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={submit}
            onChangeText={(v) => {
              setText(v.toUpperCase());
              setLocalError(false);
              setEdited(true);
            }}
            style={{
              flex: 1,
              minHeight: t.controlLg,
              paddingRight: t.space3,
              color: t.textStrong,
              fontFamily: fontFamily('sans', 'medium', i18n.language),
              fontSize: t.textMd,
            }}
          />
        </View>
        <Button variant="secondary" label={tr('checkout.promo.apply')} loading={pending} disabled={disabled || pending || text.trim() === ''} onPress={submit} />
      </View>
      {message ? (
        <Text variant="caption" tone="danger" accessibilityRole="alert">
          {message}
        </Text>
      ) : null}
    </View>
  );
}
