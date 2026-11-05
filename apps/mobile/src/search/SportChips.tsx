import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Sport } from '@booking/shared';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Text } from '../ui';
import { Chip } from '../ui/Chip';

export interface SportChipsProps {
  sports: Sport[];
  value: Sport | null;
  onChange(sport: Sport | null): void;
}

/**
 * One chip that shows the chosen sport ("Any sport ▾") and opens a bottom sheet with every sport, so no option hides
 * past the screen edge. A chosen sport turns the chip primary-soft, like the location chip.
 */
export function SportChips({ sports, value, onChange }: SportChipsProps) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const options: { sport: Sport | null; label: string }[] = [
    { sport: null, label: tr('search.anySport') },
    ...sports.map((sport) => ({ sport, label: tr(`sports.${sport}`) })),
  ];
  const current = value ? tr(`sports.${value}`) : tr('search.anySport');
  const pick = (sport: Sport | null) => {
    setOpen(false);
    onChange(sport);
  };

  return (
    <>
      <Chip
        selected={value !== null}
        accessibilityRole="button"
        accessibilityLabel={`${tr('search.sport')}: ${current}`}
        onPress={() => setOpen(true)}
      >
        <Text variant="label" tone={value ? 'primary' : 'strong'} weight={value ? 'semibold' : 'medium'}>
          {current}
        </Text>
        <Text variant="label" tone={value ? 'primary' : 'muted'} importantForAccessibility="no">
          ▾
        </Text>
      </Chip>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityElementsHidden importantForAccessibility="no" onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: t.overlay }} />
        <View accessibilityViewIsModal style={{ maxHeight: '70%', backgroundColor: t.bgSurfaceRaised, borderTopLeftRadius: t.radiusLg, borderTopRightRadius: t.radiusLg, ...t.shadowMd }}>
          <ScrollView contentContainerStyle={{ padding: t.space4, gap: t.space3 }}>
            <Text variant="title" tone="strong" accessibilityRole="header">
              {tr('search.sport')}
            </Text>
            <View accessibilityRole="radiogroup" accessibilityLabel={tr('search.sport')}>
              {options.map(({ sport, label }) => {
                const selected = sport === value;
                return (
                  <Pressable
                    key={sport ?? 'any'}
                    accessibilityRole="radio"
                    accessibilityLabel={label}
                    accessibilityState={{ checked: selected }}
                    onPress={() => pick(sport)}
                    style={({ pressed }) => ({
                      minHeight: t.controlLg,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingHorizontal: t.space3,
                      borderRadius: t.radiusMd,
                      backgroundColor: selected ? t.primarySoft : pressed ? t.bgHover : 'transparent',
                    })}
                  >
                    <Text tone={selected ? 'primary' : 'strong'} weight={selected ? 'semibold' : 'regular'}>
                      {label}
                    </Text>
                    {selected ? (
                      <Text tone="primary" importantForAccessibility="no">
                        ✓
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            <Button label={tr('common.close')} variant="secondary" onPress={() => setOpen(false)} />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
