import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en.json';
import { renderApp } from './helpers/render';
import { mockApi } from './helpers/api';

beforeEach(async () => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  mockApi([{ path: '/health', body: { status: 'ok', db: 'up' } }]);
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('theme', () => {
  it('dark sets data-theme', async () => {
    const { user } = renderApp('/');
    await user.selectOptions(screen.getByLabelText(en.theme.label), en.theme.dark);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('system removes data-theme', async () => {
    const { user } = renderApp('/');
    await user.selectOptions(screen.getByLabelText(en.theme.label), en.theme.light);
    expect(document.documentElement.dataset.theme).toBe('light');
    await user.selectOptions(screen.getByLabelText(en.theme.label), en.theme.system);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('theme')).toBe('system');
  });

  it('stored theme applies on mount', () => {
    localStorage.setItem('theme', 'dark');
    renderApp('/');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByLabelText(en.theme.label)).toHaveValue('dark');
  });
});
