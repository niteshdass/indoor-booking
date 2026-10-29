import { Route, Routes } from 'react-router';
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
import { CheckoutPage } from './checkout/CheckoutPage';
import { BookingDetailPage } from './bookings/BookingDetailPage';
import { PayPage } from './payment/PayPage';
import { LookupPage } from './lookup/LookupPage';
import { OwnerRoutes } from './owner/ownerRoutes';
import { AdminRoutes } from './admin/adminRoutes';
import { ApplyPage } from './apply/ApplyPage';
import { RequestSeriesPage } from './series/RequestSeriesPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/owner/*" element={<RequireAuth><OwnerRoutes /></RequireAuth>} />
      <Route path="/admin/*" element={<RequireAuth><AdminRoutes /></RequireAuth>} />
      <Route element={<AppShell />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/venues/:slug" element={<VenuePage />} />
        <Route path="/venues/:slug/checkout" element={<CheckoutPage />} />
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
        <Route path="/me/bookings/:id/pay" element={<RequireAuth><PayPage /></RequireAuth>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
