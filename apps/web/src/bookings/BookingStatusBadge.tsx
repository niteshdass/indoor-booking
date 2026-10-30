import { useTranslation } from 'react-i18next';
import type { BookingStatus, PaymentStatus } from '@booking/shared';
import { Badge, type Tone } from '../components/ui/Badge';

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

const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  refunded: 'info',
  partially_refunded: 'info',
  paid: 'success',
  partially_paid: 'warning',
  unpaid: 'neutral',
};

/**
 * `toVerify`: the player submitted a wallet payment staff have not checked yet. It reads "Payment to check" and never
 * "Paid", whatever the booking's own status.
 */
export function BookingStatusBadge({ status, toVerify = false }: { status: BookingStatus; toVerify?: boolean }) {
  const { t } = useTranslation();
  if (toVerify && status === 'pending') return <Badge tone="warning">{t('status.paymentToCheck')}</Badge>;
  return <Badge tone={BOOKING_TONE[status]}>{t(`status.${status}`)}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { t } = useTranslation();
  return <Badge tone={PAYMENT_TONE[status]}>{t(`paymentStatus.${status}`)}</Badge>;
}
