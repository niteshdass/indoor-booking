import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AppShell } from './components/AppShell';
import { RequireAuth } from './auth/RequireAuth';
import { SearchPage } from './search/SearchPage';
import { LandingPage } from './landing/LandingPage';
import { LoginPage } from './auth/LoginPage';
import { RegisterPage } from './auth/RegisterPage';
import { ForgotPasswordPage } from './auth/ForgotPasswordPage';
import { ResetPasswordPage } from './auth/ResetPasswordPage';
import { ProfilePage } from './auth/ProfilePage';
import { MyBookingsPage } from './bookings/MyBookingsPage';
import { VenuePage } from './venue/VenuePage';
import { BookingDetailPage } from './bookings/BookingDetailPage';
import { LookupPage } from './lookup/LookupPage';
import { ApplyPage } from './apply/ApplyPage';
import { RequestSeriesPage } from './series/RequestSeriesPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { Skeleton } from './components/ui/Skeleton';

// The portals are most of the code and most visitors never open them: each loads on first visit.
const OwnerRoutes = lazy(() => import('./owner/ownerRoutes').then((m) => ({ default: m.OwnerRoutes })));
const AdminRoutes = lazy(() => import('./admin/adminRoutes').then((m) => ({ default: m.AdminRoutes })));

// Stripe Elements only matter once someone pays.
const CheckoutPage = lazy(() => import('./checkout/CheckoutPage').then((m) => ({ default: m.CheckoutPage })));
const PayPage = lazy(() => import('./payment/PayPage').then((m) => ({ default: m.PayPage })));

function PortalLoading() {
  const { t } = useTranslation();
  return <Skeleton kind="dashboard" label={t('common.loading')} />;
}

function PageLoading() {
  const { t } = useTranslation();
  return <Skeleton kind="detail" label={t('common.loading')} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/owner/*" element={<RequireAuth><Suspense fallback={<PortalLoading />}><OwnerRoutes /></Suspense></RequireAuth>} />
      <Route path="/admin/*" element={<RequireAuth><Suspense fallback={<PortalLoading />}><AdminRoutes /></Suspense></RequireAuth>} />
      <Route element={<AppShell />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/venues/:slug" element={<VenuePage />} />
        <Route path="/venues/:slug/checkout" element={<Suspense fallback={<PageLoading />}><CheckoutPage /></Suspense>} />
        <Route path="/venues/:slug/series" element={<RequireAuth><RequestSeriesPage /></RequireAuth>} />
        <Route path="/lookup" element={<LookupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/list-your-venue" element={<RequireAuth><ApplyPage /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
        <Route path="/me/bookings" element={<RequireAuth><MyBookingsPage /></RequireAuth>} />
        <Route path="/me/bookings/:id" element={<RequireAuth><BookingDetailPage /></RequireAuth>} />
        <Route path="/me/bookings/:id/pay" element={<RequireAuth><Suspense fallback={<PageLoading />}><PayPage /></Suspense></RequireAuth>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
