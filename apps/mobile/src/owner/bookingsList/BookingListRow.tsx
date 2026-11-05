import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { amountDue, formatMoney, localParts, type PaymentStatus } from '@booking/shared';
import { BOOKING_TONE } from '../../bookings/StatusBadge';
import { useTheme } from '../../theme/ThemeProvider';
import { Badge, Text, type BadgeTone } from '../../ui';
import { customerLabel } from '../labels';
import type { OwnerBooking } from '../types';

/** Same tones as apps/web/src/bookings/BookingStatusBadge.tsx `PAYMENT_TONE`. */
export const PAYMENT_TONE: Record<PaymentStatus, BadgeTone> = {
  refunded: 'info',
  partially_refunded: 'info',
  paid: 'success',
  partially_paid: 'warning',
  unpaid: 'neutral',
};

/** A wallet payment the player submitted that staff have not checked yet (web `awaitsVerification`). */
export const awaitsVerification = (b: OwnerBooking): boolean => b.manualPayment?.status === 'pending';

/** "Thu 5 Nov" from the business date and "18:00–19:30" on the venue's clock. */
export function whenOf(b: OwnerBooking, timeZone: string, lang: string): string {
  const day = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${b.businessDate}T12:00:00Z`));
  if (b.slots.length === 0) return day;
  const start = b.slots.map((s) => s.startAt).sort()[0]!;
  const end = b.slots.map((s) => s.endAt).sort().at(-1)!;
  return `${day} · ${localParts(new Date(start), timeZone).hm}–${localParts(new Date(end), timeZone).hm}`;
}

export interface BookingListRowProps {
  booking: OwnerBooking;
  timeZone: string;
  /** Across venues each row names its venue. */
  venueName?: string;
  /** Dues tab: the amount still owed instead of the total. */
  dues: boolean;
  onPress(): void;
}

/** One booking as a card: customer and status, court · when · reference, then payment and amount. */
export function BookingListRow({ booking: b, timeZone, venueName, dues, onPress }: BookingListRowProps) {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const lang = i18n.language;
  const toVerify = awaitsVerification(b);
  const status = toVerify ? tr('status.paymentToCheck') : tr(`status.${b.status}`);
  const name = customerLabel(b, tr);
  const meta = [
    b.turf?.name ?? '—',
    venueName,
    whenOf(b, timeZone, lang),
    b.reference,
    b.source === 'walkin' ? tr('owner.bookings.sourceWalkin') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const amount = formatMoney(dues ? amountDue(b) : b.total, b.currency, lang);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${meta}, ${status}, ${dues ? `${tr('owner.bookings.due')} ${amount}` : amount}`}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? t.bgHover : t.bgSurface,
        borderRadius: t.radiusLg,
        padding: t.space4,
        gap: t.space2,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.space2 }}>
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.space2 }}>
          <Text weight="semibold" tone="strong">
            {name}
          </Text>
          {b.seriesId ? <Badge label={tr('mobile.owner.bookings.series')} tone="info" /> : null}
        </View>
        <Badge label={status} tone={toVerify ? 'warning' : BOOKING_TONE[b.status]} />
      </View>
      <Text variant="label" tone="muted">
        {meta}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }}>
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.space2 }}>
          {!toVerify ? <Badge label={tr(`paymentStatus.${b.paymentStatus}`)} tone={PAYMENT_TONE[b.paymentStatus]} /> : null}
          {dues && b.amountPaid > 0 ? (
            <Text variant="caption" tone="muted">
              {tr('owner.bookings.paidSoFar', { amount: formatMoney(b.amountPaid, b.currency, lang) })}
            </Text>
          ) : null}
        </View>
        <Text weight="semibold" tone={dues ? 'danger' : 'strong'} style={{ fontVariant: ['tabular-nums'] }}>
          {amount}
        </Text>
      </View>
    </Pressable>
  );
}
