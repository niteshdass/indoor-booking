import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import en from '../src/i18n/locales/en.json';
import ru from '../src/i18n/locales/ru.json';
import i18n from '../src/i18n';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

function Boom(): never {
  throw new Error('boom');
}

function GoHome() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/')}>go home</button>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GoHome />
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<p>home page</p>} />
          <Route path="/broken" element={<Boom />} />
        </Routes>
      </ErrorBoundary>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  // React logs caught render errors; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('shows the crash panel instead of a blank page', () => {
    renderAt('/broken');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(en.crash.title)).toBeTruthy();
    expect(screen.getByRole('button', { name: en.crash.reload })).toBeTruthy();
  });

  it('is translated', async () => {
    await i18n.changeLanguage('ru');
    renderAt('/broken');
    expect(screen.getByText(ru.crash.title)).toBeTruthy();
    expect(screen.getByRole('button', { name: ru.crash.reload })).toBeTruthy();
  });

  it('Reload reloads the page', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    renderAt('/broken');
    await userEvent.click(screen.getByRole('button', { name: en.crash.reload }));
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('clears when the user goes to another page', async () => {
    renderAt('/broken');
    await userEvent.click(screen.getByRole('button', { name: 'go home' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('home page')).toBeTruthy();
  });

  it('renders children when nothing throws', () => {
    renderAt('/');
    expect(screen.getByText('home page')).toBeTruthy();
  });
});
