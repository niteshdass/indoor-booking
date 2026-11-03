import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { BookingStatus } from '@booking/shared';
import { useTheme } from '../theme/ThemeProvider';
import { Text, type TextTone } from '../ui';

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

/** Same tones as apps/web/src/bookings/BookingStatusBadge.tsx. */
export const BOOKING_TONE: Record<BookingStatus, Tone> = {
  confirmed: 'success',
  awaiting_payment: 'warning',
  pending: 'warning',
  cancelled: 'danger',
  rejected: 'danger',
  expired: 'danger',
  completed: 'neutral',
  no_show: 'neutral',
};

const TEXT_TONE: Record<Tone, TextTone> = { success: 'success', warning: 'warning', danger: 'danger', neutral: 'muted' };

/**
 * The status as a text label on a tinted pill (never colour alone). `toVerify`: a wallet payment the venue has not
 * checked yet reads "Payment to check", never "Paid".
 */
export function StatusBadge({ status, toVerify = false }: { status: BookingStatus; toVerify?: boolean }) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const tone: Tone = toVerify ? 'warning' : BOOKING_TONE[status];
  const bg = { success: t.successSoft, warning: t.warningSoft, danger: t.dangerSoft, neutral: t.bgSubtle }[tone];
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: t.space3, paddingVertical: t.space1, borderRadius: t.radiusMd, backgroundColor: bg }}>
      <Text variant="caption" weight="semibold" tone={TEXT_TONE[tone]}>
        {toVerify ? tr('status.paymentToCheck') : tr(`status.${status}`)}
      </Text>
    </View>
  );
}
