import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney, type AddonSelection } from '@booking/shared';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui';
import type { OfferedAddon } from './types';

export interface AddonPickerProps {
  /** Add-ons the player can pick (auto ones are left out by the caller). */
  addons: OfferedAddon[];
  currency: string;
  value: AddonSelection[];
  onChange(next: AddonSelection[]): void;
  /** Nothing can change (e.g. while a booking may still be going through). */
  disabled?: boolean;
}

const qty = (value: AddonSelection[], id: string) => value.find((s) => s.addonId === id)?.quantity ?? 0;

/** Offered order, zero quantities left out, so the quote body is stable. */
function setQty(addons: OfferedAddon[], value: AddonSelection[], id: string, quantity: number): AddonSelection[] {
  return addons
    .map((a) => ({ addonId: a.id, quantity: a.id === id ? quantity : qty(value, a.id) }))
    .filter((s) => s.quantity > 0);
}

/** Per-unit extras get a stepper, the rest a checkbox. Checked state shows a ✓ and a border, never color alone. */
export function AddonPicker({ addons, currency, value, onChange, disabled = false }: AddonPickerProps) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();

  return (
    <View style={{ gap: t.space2 }}>
      {addons.map((a) => {
        const n = qty(value, a.id);
        const price = `${formatMoney(a.unitPrice, currency, i18n.language)} ${tr(`addons.${a.pricingType}`)}`;
        if (a.pricingType === 'per_unit') {
          const step = (d: number) => onChange(setQty(addons, value, a.id, Math.min(a.maxQuantity, Math.max(0, n + d))));
          return (
            <View key={a.id} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: t.space2 }}>
              <View style={{ flexShrink: 1, flexGrow: 1 }}>
                <Text weight="medium" tone="strong">
                  {a.name}
                </Text>
                <Text variant="caption" tone="muted">
                  {price}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }}>
                <StepButton label={tr('checkout.decrease', { name: a.name })} glyph="−" disabled={disabled || n <= 0} onPress={() => step(-1)} />
                <Text
                  weight="semibold"
                  tone="strong"
                  accessibilityLabel={tr('checkout.quantity', { name: a.name })}
                  accessibilityValue={{ now: n, min: 0, max: a.maxQuantity }}
                  style={{ minWidth: t.space6, textAlign: 'center' }}
                >
                  {String(n)}
                </Text>
                <StepButton label={tr('checkout.increase', { name: a.name })} glyph="+" disabled={disabled || n >= a.maxQuantity} onPress={() => step(1)} />
              </View>
            </View>
          );
        }
        const on = n > 0;
        return (
          <Pressable
            key={a.id}
            accessibilityRole="checkbox"
            accessibilityLabel={`${a.name}, ${price}`}
            accessibilityState={{ checked: on, disabled }}
            disabled={disabled}
            onPress={() => onChange(setQty(addons, value, a.id, on ? 0 : 1))}
            style={{ minHeight: t.controlLg, flexDirection: 'row', alignItems: 'center', gap: t.space3, opacity: disabled ? t.opacityMuted : 1 }}
          >
            <View
              style={{
                width: t.space6,
                height: t.space6,
                borderRadius: t.radiusSm,
                borderWidth: t.focusWidth,
                borderColor: on ? t.primary : t.borderStrong,
                backgroundColor: on ? t.primary : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {on ? (
                <Text variant="caption" weight="bold" style={{ color: t.primaryFg }}>
                  ✓
                </Text>
              ) : null}
            </View>
            <View style={{ flexShrink: 1 }}>
              <Text weight="medium" tone="strong">
                {a.name}
              </Text>
              <Text variant="caption" tone="muted">
                {price}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function StepButton({ label, glyph, disabled, onPress }: { label: string; glyph: string; disabled: boolean; onPress(): void }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: t.controlLg,
        minHeight: t.controlLg,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: t.radiusMd,
        backgroundColor: pressed ? t.controlFillHover : t.controlFill,
        opacity: disabled ? t.opacityMuted : 1,
      })}
    >
      <Text variant="title" tone="strong">
        {glyph}
      </Text>
    </Pressable>
  );
}
