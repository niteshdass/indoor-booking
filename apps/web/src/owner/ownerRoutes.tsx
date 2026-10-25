import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BookingsPage } from './bookings/BookingsPage';
import { OwnerBookingPage } from './bookings/OwnerBookingPage';
import { OwnerIndexPage } from './OwnerIndexPage';
import { OwnerProvider } from './OwnerProvider';
import { RequirePermission } from './RequirePermission';
import { SchedulePage } from './schedule/SchedulePage';
import { NAV } from './shell/nav';
import { OwnerShell } from './shell/OwnerShell';
import { TodayPage } from './today/TodayPage';
import type { Permission } from './types';

function ComingSoon() {
  const { t } = useTranslation();
  return <p>{t('owner.comingSoon')}</p>;
}

/** Guards a page with the permissions of its NAV entry, or with explicit ones for routes outside the nav. */
function Guarded({ nav, perm, any, children }: { nav?: string; perm?: Permission[]; any?: boolean; children: ReactNode }) {
  const item = nav === undefined ? undefined : NAV.find((n) => n.to === nav);
  const perms = item?.perms ?? perm ?? [];
  return (
    <RequirePermission perm={perms} any={item?.any ?? any}>
      {children}
    </RequirePermission>
  );
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
            <OwnerShell />
          </OwnerProvider>
        }
      >
        <Route index element={<Guarded nav=""><TodayPage /></Guarded>} />
        <Route path="schedule" element={<Guarded nav="schedule"><SchedulePage /></Guarded>} />
        <Route path="bookings" element={<Guarded nav="bookings"><BookingsPage /></Guarded>} />
        <Route path="bookings/:bookingId" element={<Guarded perm={['booking.view']}><OwnerBookingPage /></Guarded>} />
        <Route path="walk-in" element={<Guarded nav="walk-in"><ComingSoon /></Guarded>} />
        <Route path="venues" element={<Guarded nav="venues"><ComingSoon /></Guarded>} />
        {/* Any member may open these; the pages go read-only without edit permissions. */}
        <Route path="venues/new" element={<Guarded><ComingSoon /></Guarded>} />
        <Route path="venues/:venueId" element={<Guarded><ComingSoon /></Guarded>} />
        <Route path="venues/:venueId/turfs/:turfId" element={<Guarded><ComingSoon /></Guarded>} />
        <Route path="closures" element={<Guarded nav="closures"><ComingSoon /></Guarded>} />
        <Route path="addons" element={<Guarded nav="addons"><ComingSoon /></Guarded>} />
        <Route path="settings" element={<Guarded nav="settings"><ComingSoon /></Guarded>} />
        <Route path="staff" element={<Guarded nav="staff"><ComingSoon /></Guarded>} />
        <Route path="activity" element={<Guarded nav="activity"><ComingSoon /></Guarded>} />
      </Route>
    </Routes>
  );
}
