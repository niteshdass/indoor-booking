import { Pressable, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui';

export interface CourtTabsProps {
  courts: { id: string; name: string }[];
  value: string;
  onChange(id: string): void;
}

/** Court tabs. The active one is filled with the venue brand color and also bordered and semibold, never color alone. */
export function CourtTabs({ courts, value, onChange }: CourtTabsProps) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      accessibilityLabel={tr('venue.turfs')}
      contentContainerStyle={{ gap: t.space2 }}
    >
      {courts.map((c) => {
        const active = c.id === value;
        return (
          <Pressable
            key={c.id}
            accessibilityRole="tab"
            accessibilityLabel={c.name}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(c.id)}
            style={{
              minHeight: t.controlLg,
              justifyContent: 'center',
              paddingHorizontal: t.space4,
              borderRadius: t.radiusMd,
              borderWidth: t.focusWidth,
              borderColor: active ? t.brand : t.borderSubtle,
              backgroundColor: active ? t.brand : t.bgSurface,
            }}
          >
            <Text variant="label" weight={active ? 'bold' : 'medium'} style={{ color: active ? t.brandFg : t.textStrong }}>
              {c.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
