import type { ReactNode } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from '../../ui';

type Props = {
  title: string;
  detail?: string;
  /** Small things beside the switch, e.g. a state badge. */
  right?: ReactNode;
  /** Tapping the text opens the editor; the switch only flips `value`. */
  onPress?(): void;
  value: boolean;
  onChange(value: boolean): void;
  switchLabel: string;
  disabled?: boolean;
};

/** A row inside a Group whose body and switch do different things (Row's toggle makes the whole row the switch). */
export function ToggleRow({ title, detail, right, onPress, value, onChange, switchLabel, disabled }: Props) {
  const { t } = useTheme();
  const text = (
    <View style={{ flex: 1, gap: t.space1 / 2 }}>
      <Text tone="strong">{title}</Text>
      {detail ? (
        <Text variant="caption" tone="muted">
          {detail}
        </Text>
      ) : null}
    </View>
  );
  return (
    <View style={{ minHeight: t.controlLg + t.space1, flexDirection: 'row', alignItems: 'center', gap: t.space3, paddingRight: t.space4 }}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={detail ? `${title}, ${detail}` : title}
          onPress={onPress}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: t.controlLg + t.space1,
            paddingLeft: t.space4,
            paddingVertical: t.space2,
            backgroundColor: pressed ? t.bgHover : 'transparent',
          })}
        >
          {text}
        </Pressable>
      ) : (
        <View style={{ flex: 1, flexDirection: 'row', paddingLeft: t.space4, paddingVertical: t.space2 }}>{text}</View>
      )}
      {right}
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={switchLabel}
        trackColor={{ false: t.borderDefault, true: t.success }}
        thumbColor={t.bgSurfaceRaised}
      />
    </View>
  );
}
