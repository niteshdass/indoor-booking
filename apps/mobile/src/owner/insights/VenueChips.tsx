import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/ThemeProvider';
import { Chip, Text } from '../../ui';
import { useOwner } from '../OwnerProvider';

/** One chip per venue the member can see; the screen shows one venue at a time (as the web portal does). */
export function VenueChips({ value, onChange }: { value: string; onChange(id: string): void }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { venues } = useOwner();
  if (venues.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={tr('mobile.owner.insights.venues')}
      contentContainerStyle={{ gap: t.space2, paddingVertical: t.space1 }}
    >
      {venues.map((v) => {
        const on = v.id === value;
        return (
          <Chip key={v.id} selected={on} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={v.name} onPress={() => onChange(v.id)}>
            <Text variant="label" tone={on ? 'primary' : 'default'} weight={on ? 'semibold' : 'medium'}>
              {v.name}
            </Text>
          </Chip>
        );
      })}
    </ScrollView>
  );
}
