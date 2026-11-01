import { BrowserRouter } from 'react-router';
import { ThemeProvider } from './theme/ThemeProvider';
import { AuthProvider } from './auth/AuthProvider';
import { AppRoutes } from './routes';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SkipLink } from './components/SkipLink';

export function App() {
  return (
    <ThemeProvider>
      <SkipLink />
      <BrowserRouter>
        <ErrorBoundary>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </ThemeProvider>
  );
}
