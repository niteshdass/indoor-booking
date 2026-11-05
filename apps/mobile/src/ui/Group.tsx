import { Children, isValidElement, type ReactNode } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** Uppercase muted label above a group of rows. */
export function GroupLabel({ children }: { children: string }) {
  const { t } = useTheme();
  return (
    <Text variant="caption" weight="semibold" tone="muted" accessibilityRole="header" style={{ textTransform: 'uppercase', marginTop: t.space2 }}>
      {children}
    </Text>
  );
}

/** Rows on one surface card, split by hairlines. */
export function Group({ children }: { children: ReactNode }) {
  const { t } = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={{ backgroundColor: t.bgSurface, borderRadius: t.radiusLg, overflow: 'hidden' }}>
      {rows.map((row, i) => (
        <View key={row.key ?? i} style={i > 0 ? { borderTopWidth: t.hairline, borderTopColor: t.borderSubtle } : undefined}>
          {row}
        </View>
      ))}
    </View>
  );
}

export interface RowProps {
  title: string;
  /** Muted second line. */
  detail?: string;
  icon?: IconName;
  /** Right side: a badge, amount or anything small. A chevron shows when `onPress` is set and there is no `right`/`toggle`. */
  right?: ReactNode;
  /** Left side instead of `icon`, e.g. an avatar. */
  left?: ReactNode;
  tone?: 'default' | 'danger' | 'primary';
  onPress?(): void;
  /** A switch on the right; the whole row toggles it. */
  toggle?: { value: boolean; onChange(v: boolean): void; disabled?: boolean };
}

/** One list row: 44pt+ tall, title wraps instead of truncating (long Russian labels). */
export function Row({ title, detail, icon, right, left, tone = 'default', onPress, toggle }: RowProps) {
  const { t } = useTheme();
  const color = tone === 'danger' ? t.danger : tone === 'primary' ? t.primary : t.textStrong;
  const press = toggle ? () => !toggle.disabled && toggle.onChange(!toggle.value) : onPress;
  const body = (
    <>
      {left ?? (icon ? <Icon name={icon} color={color} /> : null)}
      <View style={{ flex: 1, gap: t.space1 / 2 }}>
        <Text style={{ color }}>{title}</Text>
        {detail ? (
          <Text variant="caption" tone="muted">
            {detail}
          </Text>
        ) : null}
      </View>
      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          disabled={toggle.disabled}
          // The row itself is the switch for assistive tech; the inner one would be announced twice.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          trackColor={{ false: t.borderDefault, true: t.success }}
          thumbColor={t.bgSurfaceRaised}
        />
      ) : (
        right ?? (onPress ? <Icon name="chevronRight" color={t.textMuted} size={t.iconSm} /> : null)
      )}
    </>
  );
  const style = { minHeight: t.controlLg + t.space1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space3, paddingHorizontal: t.space4, paddingVertical: t.space2 };
  if (!press) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole={toggle ? 'switch' : 'button'}
      accessibilityState={toggle ? { checked: toggle.value, disabled: toggle.disabled } : undefined}
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      onPress={press}
      style={({ pressed }) => [style, pressed ? { backgroundColor: t.bgHover } : null]}
    >
      {body}
    </Pressable>
  );
}
