import { useLocalSearchParams } from 'expo-router';
import { BookingDetailScreen } from '../../../../src/owner/booking';

/** Owner booking detail: facts, money, payments, refunds, bookings made together, actions. */
export default function OwnerBookingRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BookingDetailScreen bookingId={String(id ?? '')} />;
}
