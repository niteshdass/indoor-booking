import { Outlet, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { OwnerIndexPage } from './OwnerIndexPage';
import { OwnerProvider } from './OwnerProvider';

function ComingSoon() {
  const { t } = useTranslation();
  return <p>{t('owner.comingSoon')}</p>;
}

/** The `/owner/*` tree. Later tasks replace each placeholder with its page. */
export function OwnerRoutes() {
  return (
    <Routes>
      <Route index element={<OwnerIndexPage />} />
      <Route
        path=":ownerId"
        element={
          <OwnerProvider>
            <Outlet />
          </OwnerProvider>
        }
      >
        <Route index element={<ComingSoon />} />
        <Route path="schedule" element={<ComingSoon />} />
        <Route path="bookings" element={<ComingSoon />} />
        <Route path="bookings/:bookingId" element={<ComingSoon />} />
        <Route path="walk-in" element={<ComingSoon />} />
        <Route path="venues" element={<ComingSoon />} />
        <Route path="venues/new" element={<ComingSoon />} />
        <Route path="venues/:venueId" element={<ComingSoon />} />
        <Route path="venues/:venueId/turfs/:turfId" element={<ComingSoon />} />
        <Route path="closures" element={<ComingSoon />} />
        <Route path="addons" element={<ComingSoon />} />
        <Route path="settings" element={<ComingSoon />} />
        <Route path="staff" element={<ComingSoon />} />
        <Route path="activity" element={<ComingSoon />} />
      </Route>
    </Routes>
  );
}
