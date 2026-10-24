import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en.json';
import ru from '../src/i18n/locales/ru.json';
import { renderApp } from './helpers/render';

beforeEach(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok', db: 'up' }), { status: 200 })),
  );
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('HomePage', () => {
  it('renders English title by default and switches to Russian', async () => {
    const { user } = renderApp('/');
    expect(screen.getByRole('heading', { name: en.home.title })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(en.language.label), 'ru');
    expect(screen.getByRole('heading', { name: ru.home.title })).toBeInTheDocument();
  });
});
