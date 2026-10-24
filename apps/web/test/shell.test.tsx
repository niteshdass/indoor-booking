import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en.json';
import ru from '../src/i18n/locales/ru.json';
import { renderApp } from './helpers/render';
import { mockApi } from './helpers/api';

beforeEach(async () => {
  mockApi([{ path: '/health', body: { status: 'ok', db: 'up' } }]);
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('app shell', () => {
  it('unknown path shows not found', () => {
    renderApp('/nope');
    expect(screen.getByRole('heading', { name: en.notFound.title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.notFound.home })).toHaveAttribute('href', '/');
  });

  it('signed-out nav', () => {
    renderApp('/nope');
    expect(screen.getByRole('link', { name: en.nav.signIn })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: en.nav.lookup })).toHaveAttribute('href', '/lookup');
  });

  it('language switch re-renders nav in Russian', async () => {
    const { user } = renderApp('/nope');
    await user.selectOptions(screen.getByLabelText(en.language.label), 'ru');
    expect(screen.getByRole('link', { name: ru.nav.signIn })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: ru.nav.lookup })).toBeInTheDocument();
  });
});
