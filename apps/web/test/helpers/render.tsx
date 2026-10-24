import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import i18n from '../../src/i18n';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { AppRoutes } from '../../src/routes';
import type { PublicUser } from '../../src/lib/types';

/** Renders the whole app at `path`. `opts.user` is wired to AuthProvider's `initialUser` from Task 4 on. */
export function renderApp(path: string, _opts?: { user?: PublicUser }): RenderResult & { user: UserEvent } {
  const user = userEvent.setup();
  const ui: ReactElement = (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>
  );
  return { ...render(ui), user };
}
