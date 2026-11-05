import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface SegmentedProps<V extends string> {
  options: { value: V; label: string }[];
  value: V;
  onChange(v: V): void;
  /** Accessible name of the whole control. */
  label: string;
}

/** Two to four mutually exclusive options in one track; segments share the width and wrap their label. */
export function Segmented<V extends string>({ options, value, onChange, label }: SegmentedProps<V>) {
  const { t } = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: t.controlFill, borderRadius: t.radiusMd, padding: t.space1 / 2 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              minHeight: t.controlSm,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: t.space2,
              borderRadius: t.radiusSm,
              backgroundColor: on ? t.bgSurfaceRaised : 'transparent',
            }}
          >
            <Text variant="label" weight={on ? 'semibold' : 'medium'} tone={on ? 'strong' : 'muted'} style={{ textAlign: 'center' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
