import { useTranslation } from 'react-i18next';

/** Placeholder until the bookings list lands. */
export function MyBookingsPage() {
  const { t } = useTranslation();
  return (
    <main>
      <h1>{t('nav.myBookings')}</h1>
    </main>
  );
}
