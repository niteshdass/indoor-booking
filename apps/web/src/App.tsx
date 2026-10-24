import { BrowserRouter } from 'react-router';
import { ThemeProvider } from './theme/ThemeProvider';
import { AppRoutes } from './routes';

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ThemeProvider>
  );
}
