import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { addDays } from '@booking/shared';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon, Text } from '../../ui';
import { formatDay, todayIso } from './dates';

type Props = {
  label: string;
  /** YYYY-MM-DD, or '' when `emptyLabel` is given (e.g. "Now", "No end"). */
  value: string;
  onChange(value: string): void;
  emptyLabel?: string;
  error?: string;
};

/** A whole-day picker without a native date dependency: ‹ day › steppers, plus "Clear" when the date is optional. */
export function DateStepper({ label, value, onChange, emptyLabel, error }: Props) {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const shown = value === '' ? (emptyLabel ?? tr('mobile.owner.setup.dateNote')) : formatDay(value, i18n.language);
  const step = (n: number) => onChange(value === '' ? todayIso() : addDays(value, n));
  return (
    <View style={{ gap: t.space1 }}>
      <Text variant="label" tone="strong">
        {label}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space2,
          backgroundColor: t.controlFill,
          borderRadius: t.radiusMd,
          borderWidth: t.hairline,
          borderColor: error ? t.danger : 'transparent',
        }}
      >
        <StepIcon icon="arrowLeft" label={tr('mobile.owner.setup.closures.dayBefore')} onPress={() => step(-1)} />
        <Text tone={value === '' ? 'muted' : 'strong'} weight="semibold" accessibilityLabel={`${label}: ${shown}`} style={{ flex: 1, textAlign: 'center' }}>
          {shown}
        </Text>
        <StepIcon icon="arrowRight" label={tr('mobile.owner.setup.closures.dayAfter')} onPress={() => step(1)} />
      </View>
      {emptyLabel !== undefined && value !== '' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${tr('mobile.owner.setup.coupons.clear')}: ${label}`}
          onPress={() => onChange('')}
          style={{ alignSelf: 'flex-start', minHeight: t.controlLg, justifyContent: 'center' }}
        >
          <Text variant="label" tone="primary">
            {tr('mobile.owner.setup.coupons.clear')}
          </Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function StepIcon({ icon, label, onPress }: { icon: 'arrowLeft' | 'arrowRight'; label: string; onPress(): void }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: t.controlLg,
        height: t.controlLg,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: t.radiusMd,
        backgroundColor: pressed ? t.controlFillHover : 'transparent',
      })}
    >
      <Icon name={icon} color={t.textStrong} size={t.iconSm} />
    </Pressable>
  );
}
