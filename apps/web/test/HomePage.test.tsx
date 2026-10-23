import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en.json';
import ru from '../src/i18n/locales/ru.json';
import { HomePage } from '../src/pages/HomePage';

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
    render(
      <I18nextProvider i18n={i18n}>
        <HomePage />
      </I18nextProvider>,
    );
    expect(screen.getByRole('heading', { name: en.home.title })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(en.language.label), 'ru');
    expect(screen.getByRole('heading', { name: ru.home.title })).toBeInTheDocument();
  });
});
