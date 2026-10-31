import { Route, Routes } from 'react-router';
import { AdminActivityPage } from './AdminActivityPage';
import { AdminDocsPage } from './docs/AdminDocsPage';
import { AdminOverviewPage } from './AdminOverviewPage';
import { AdminOwnerDetailPage } from './AdminOwnerDetailPage';
import { AdminOwnersPage } from './AdminOwnersPage';
import { AdminPayoutsPage } from './AdminPayoutsPage';
import { AdminProvider } from './AdminProvider';
import { AdminReviewsPage } from './AdminReviewsPage';
import { AdminShell } from './AdminShell';
import { AdminSettingsPage } from './AdminSettingsPage';
import { AdminUsersPage } from './AdminUsersPage';

/** The `/admin/*` tree: platform admins only (the provider shows a notice to anyone else). */
export function AdminRoutes() {
  return (
    <AdminProvider>
      <Routes>
        <Route element={<AdminShell />}>
          <Route index element={<AdminOverviewPage />} />
          <Route path="owners" element={<AdminOwnersPage />} />
          <Route path="owners/:ownerId" element={<AdminOwnerDetailPage />} />
          <Route path="payouts" element={<AdminPayoutsPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="reviews" element={<AdminReviewsPage />} />
          <Route path="activity" element={<AdminActivityPage />} />
          <Route path="settings" element={<AdminSettingsPage />} />
        </Route>
        <Route path="docs/:topic?" element={<AdminDocsPage />} />
      </Routes>
    </AdminProvider>
  );
}
