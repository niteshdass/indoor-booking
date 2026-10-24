import { Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { RequireAuth } from './auth/RequireAuth';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { MyBookingsPage } from './pages/MyBookingsPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/me/bookings" element={<RequireAuth><MyBookingsPage /></RequireAuth>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
