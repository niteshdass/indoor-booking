import { useTranslation } from 'react-i18next';
import type { BookingStatus, PaymentStatus } from '@booking/shared';
import { Badge, type Tone } from '../components/ui/Badge';

const BOOKING_TONE: Record<BookingStatus, Tone> = {
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

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const { t } = useTranslation();
  return <Badge tone={BOOKING_TONE[status]}>{t(`status.${status}`)}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { t } = useTranslation();
  return <Badge tone={PAYMENT_TONE[status]}>{t(`paymentStatus.${status}`)}</Badge>;
}
