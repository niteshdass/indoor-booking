import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@booking/shared';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui';
import { bookingWhen } from './format';
import { StatusBadge } from './StatusBadge';
import type { PlayerBooking } from './types';

/** One booking in the list: venue, court, venue-local day and time, status and total. */
export function BookingRow({ booking, onPress }: { booking: PlayerBooking; onPress(): void }) {
  const { t } = useTheme();
  const { i18n } = useTranslation();
  const { day, range } = bookingWhen(booking, i18n.language);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: t.controlLg,
        gap: t.space2,
        padding: t.space4,
        borderRadius: t.radiusLg,
        backgroundColor: pressed ? t.bgHover : t.bgSurface,
      })}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: t.space2 }}>
        <Text variant="title" tone="strong" style={{ flexShrink: 1 }}>
          {booking.venue?.name ?? booking.reference}
        </Text>
        <StatusBadge status={booking.status} />
      </View>
      <Text tone="muted">{[booking.turf?.name, day, range].filter(Boolean).join(' · ')}</Text>
      <Text weight="semibold" tone="strong">
        {formatMoney(booking.total, booking.currency, i18n.language)}
      </Text>
    </Pressable>
  );
}
