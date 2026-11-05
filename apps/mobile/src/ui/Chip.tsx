import type { ReactNode } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface ChipProps extends Omit<PressableProps, 'style' | 'children'> {
  selected?: boolean;
  children: ReactNode;
}

/** Compact pill (control-md, hit area stretched to control-lg). Selected = primary-soft fill plus a primary border, not only a fill. */
export function Chip({ selected = false, children, ...rest }: ChipProps) {
  const { t } = useTheme();
  const slop = (t.controlLg - t.controlMd) / 2;
  return (
    <Pressable
      {...rest}
      hitSlop={{ top: slop, bottom: slop }}
      style={({ pressed }) => ({
        minHeight: t.controlMd,
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space1,
        paddingHorizontal: t.space3,
        borderRadius: t.radiusFull,
        borderWidth: t.focusWidth,
        borderColor: selected ? t.primary : 'transparent',
        backgroundColor: selected ? t.primarySoft : pressed ? t.controlFillHover : t.controlFill,
      })}
    >
      {children}
    </Pressable>
  );
}
