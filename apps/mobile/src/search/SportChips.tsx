import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Sport } from '@booking/shared';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui';

export interface SportChipsProps {
  sports: Sport[];
  value: Sport | null;
  onChange(sport: Sport | null): void;
}

/** Wrapping chips, one per sport plus "Any sport". Width follows the label; the selected chip also gets a border, not only a fill. */
export function SportChips({ sports, value, onChange }: SportChipsProps) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const options: { sport: Sport | null; label: string }[] = [
    { sport: null, label: tr('search.anySport') },
    ...sports.map((sport) => ({ sport, label: tr(`sports.${sport}`) })),
  ];
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={tr('search.sport')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
      {options.map(({ sport, label }) => {
        const selected = sport === value;
        return (
          <Pressable
            key={sport ?? 'any'}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(sport)}
            style={{
              minHeight: t.controlLg,
              justifyContent: 'center',
              paddingHorizontal: t.space3,
              borderRadius: t.radiusFull,
              borderWidth: t.focusWidth,
              borderColor: selected ? t.primary : 'transparent',
              backgroundColor: selected ? t.primarySoft : t.controlFill,
            }}
          >
            <Text variant="label" tone={selected ? 'primary' : 'strong'} weight={selected ? 'semibold' : 'medium'}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
