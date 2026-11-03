import { Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { addDays } from '@booking/shared';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui';

export interface DateStripProps {
  /** The venue's today, `YYYY-MM-DD`. */
  today: string;
  value: string;
  onChange(date: string): void;
  days?: number;
}

const at = (d: string) => new Date(`${d}T00:00:00Z`);

/** A horizontal run of days from the venue's today. Labels are venue-local calendar dates, formatted as UTC. */
export function DateStrip({ today, value, onChange, days = 14 }: DateStripProps) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' });
  const dayMonth = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={tr('venue.dateStrip')}
      contentContainerStyle={{ gap: t.space2 }}
    >
      {Array.from({ length: days }, (_, i) => addDays(today, i)).map((d) => {
        const selected = d === value;
        const first = d === today ? tr('venue.todayChip') : weekday.format(at(d));
        const second = dayMonth.format(at(d));
        return (
          <Pressable
            key={d}
            accessibilityRole="radio"
            accessibilityLabel={`${first}, ${second}`}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(d)}
            style={{
              minHeight: t.controlLg,
              minWidth: t.dateTile,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: t.space3,
              paddingVertical: t.space2,
              borderRadius: t.radiusMd,
              borderWidth: t.focusWidth,
              borderColor: selected ? t.brand : t.borderSubtle,
              backgroundColor: selected ? t.brand : t.bgSurface,
            }}
          >
            <View>
              <Text variant="caption" style={{ color: selected ? t.brandFg : t.textMuted, textAlign: 'center' }}>
                {first}
              </Text>
              <Text variant="label" weight={selected ? 'bold' : 'medium'} style={{ color: selected ? t.brandFg : t.textStrong, textAlign: 'center' }}>
                {second}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
