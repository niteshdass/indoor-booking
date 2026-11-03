import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonTone = 'default' | 'danger';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  tone?: ButtonTone;
  loading?: boolean;
}

/** Width follows the label: Russian and Bangla run up to 30% longer, so nothing here is fixed-width. */
export function Button({ label, variant = 'primary', tone = 'default', loading = false, disabled, ...rest }: ButtonProps) {
  const { t } = useTheme();
  const danger = tone === 'danger';
  const inactive = disabled || loading;
  const palette = {
    primary: { bg: danger ? t.danger : t.primary, fg: danger ? t.bgPage : t.primaryFg, pressed: danger ? t.danger : t.primaryHover },
    secondary: { bg: t.controlFill, fg: danger ? t.danger : t.textStrong, pressed: t.controlFillHover },
    ghost: { bg: 'transparent', fg: danger ? t.danger : t.primary, pressed: t.bgHover },
  }[variant];

  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: loading }}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: t.controlLg,
          paddingHorizontal: t.space4,
          paddingVertical: t.space2,
          borderRadius: t.radiusMd,
          backgroundColor: pressed ? palette.pressed : palette.bg,
          opacity: inactive ? t.opacityMuted : 1,
        },
      ]}
    >
      <View style={[styles.row, { gap: t.space2 }]}>
        {loading ? <ActivityIndicator color={palette.fg} /> : null}
        <Text variant="label" weight="semibold" style={{ color: palette.fg, textAlign: 'center' }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
