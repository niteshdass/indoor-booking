import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router';
import i18n from '../../src/i18n';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { AuthProvider } from '../../src/auth/AuthProvider';
import { AppRoutes } from '../../src/routes';
import type { PublicUser } from '../../src/lib/types';

/** Renders the whole app at `path`. `opts.user` is passed to AuthProvider's `initialUser`. */
function LocationProbe({ onChange }: { onChange(l: { pathname: string; search: string; navType: string }): void }) {
  const { pathname, search } = useLocation();
  const navType = useNavigationType();
  onChange({ pathname, search, navType });
  return null;
}

export function renderApp(path: string, opts?: { user?: PublicUser }): RenderResult & { user: UserEvent; location(): { pathname: string; search: string; navType: string } } {
  const user = userEvent.setup();
  let current = { pathname: path.split('?')[0] ?? path, search: '', navType: 'POP' };
  const ui: ReactElement = (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider initialUser={opts?.user ?? null}>
            <AppRoutes />
          </AuthProvider>
          <LocationProbe onChange={(l) => (current = l)} />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>
  );
  return { ...render(ui), user, location: () => current };
}
