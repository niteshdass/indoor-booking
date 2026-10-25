import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { ActivityPage } from './activity/ActivityPage';
import { AddonsPage } from './addons/AddonsPage';
import { BookingsPage } from './bookings/BookingsPage';
import { OwnerBookingPage } from './bookings/OwnerBookingPage';
import { OwnerIndexPage } from './OwnerIndexPage';
import { OwnerProvider } from './OwnerProvider';
import { RequirePermission } from './RequirePermission';
import { ClosuresPage } from './schedule/ClosuresPage';
import { ReviewsPage } from './reviews/ReviewsPage';
import { SchedulePage } from './schedule/SchedulePage';
import { NAV } from './shell/nav';
import { OwnerShell } from './shell/OwnerShell';
import { TodayPage } from './today/TodayPage';
import { SettingsPage } from './settings/SettingsPage';
import { StaffPage } from './staff/StaffPage';
import { WalkInPage } from './walkin/WalkInPage';
import { TurfEditorPage } from './turfs/TurfEditorPage';
import { VenueEditorPage } from './venues/VenueEditorPage';
import { VenuesPage } from './venues/VenuesPage';
import type { Permission } from './types';

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

/** The `/owner/*` tree. */
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
        <Route path="walk-in" element={<Guarded nav="walk-in"><WalkInPage /></Guarded>} />
        <Route path="venues" element={<Guarded nav="venues"><VenuesPage /></Guarded>} />
        {/* Any member may open these; the pages go read-only without edit permissions. */}
        <Route path="venues/new" element={<Guarded><VenueEditorPage /></Guarded>} />
        <Route path="venues/:venueId" element={<Guarded><VenueEditorPage /></Guarded>} />
        <Route path="venues/:venueId/turfs/:turfId" element={<Guarded><TurfEditorPage /></Guarded>} />
        <Route path="closures" element={<Guarded nav="closures"><ClosuresPage /></Guarded>} />
        <Route path="addons" element={<Guarded nav="addons"><AddonsPage /></Guarded>} />
        <Route path="settings" element={<Guarded nav="settings"><SettingsPage /></Guarded>} />
        <Route path="staff" element={<Guarded nav="staff"><StaffPage /></Guarded>} />
        <Route path="reviews" element={<Guarded nav="reviews"><ReviewsPage /></Guarded>} />
        <Route path="activity" element={<Guarded nav="activity"><ActivityPage /></Guarded>} />
      </Route>
    </Routes>
  );
}
