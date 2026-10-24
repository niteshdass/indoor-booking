import { Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { RequireAuth } from './auth/RequireAuth';
import { SearchPage } from './search/SearchPage';
import { LoginPage } from './auth/LoginPage';
import { RegisterPage } from './auth/RegisterPage';
import { ForgotPasswordPage } from './auth/ForgotPasswordPage';
import { ResetPasswordPage } from './auth/ResetPasswordPage';
import { ProfilePage } from './auth/ProfilePage';
import { MyBookingsPage } from './pages/MyBookingsPage';
import { VenuePage } from './venue/VenuePage';
import { CheckoutPage } from './checkout/CheckoutPage';
import { BookingDetailPage } from './bookings/BookingDetailPage';
import { PayPage } from './payment/PayPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<SearchPage />} />
        <Route path="/venues/:slug" element={<VenuePage />} />
        <Route path="/venues/:slug/checkout" element={<CheckoutPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
        <Route path="/me/bookings" element={<RequireAuth><MyBookingsPage /></RequireAuth>} />
        <Route path="/me/bookings/:id" element={<RequireAuth><BookingDetailPage /></RequireAuth>} />
        <Route path="/me/bookings/:id/pay" element={<RequireAuth><PayPage /></RequireAuth>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
