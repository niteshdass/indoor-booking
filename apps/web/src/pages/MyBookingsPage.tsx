import { useTranslation } from 'react-i18next';

/** Placeholder until the bookings list lands. */
export function MyBookingsPage() {
  const { t } = useTranslation();
  return (
    <main>
      <h1>{t('myBookings.title')}</h1>
    </main>
  );
}
