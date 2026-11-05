import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Chip, Text } from '../../ui';

/** Pick one of a few named things (venue, court) as wrapping chips. */
export function ChipPicker({ label, options, value, onChange, error }: { label: string; options: { id: string; name: string }[]; value: string; onChange(id: string): void; error?: string }) {
  const { t } = useTheme();
  return (
    <View style={{ gap: t.space2 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text variant="label" tone="strong">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <Chip key={o.id} selected={on} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={o.name} onPress={() => onChange(o.id)}>
              <Text variant="label" tone={on ? 'primary' : 'default'}>
                {o.name}
              </Text>
            </Chip>
          );
        })}
      </View>
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
