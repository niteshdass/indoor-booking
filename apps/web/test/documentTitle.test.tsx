import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';
import i18n from '../src/i18n';
import { NotFoundPage } from '../src/pages/NotFoundPage';
import { useDocumentTitle } from '../src/lib/useDocumentTitle';

const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');

function Titled({ title }: { title?: string | null }) {
  useDocumentTitle(title);
  return null;
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  document.title = '';
});

describe('document title', () => {
  it('is "<page> · BookaTurf", or the bare brand without a page title', () => {
    const { rerender } = render(
      <MemoryRouter>
        <Titled title="Find a turf" />
      </MemoryRouter>,
    );
    expect(document.title).toBe('Find a turf · BookaTurf');
    rerender(
      <MemoryRouter>
        <Titled title={null} />
      </MemoryRouter>,
    );
    expect(document.title).toBe('BookaTurf');
  });

  it('follows the language', async () => {
    render(
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <NotFoundPage />
        </I18nextProvider>
      </MemoryRouter>,
    );
    expect(document.title).toBe('Page not found · BookaTurf');
    await i18n.changeLanguage('ru');
    await new Promise((r) => setTimeout(r, 0));
    expect(document.title).toBe('Страница не найдена · BookaTurf');
  });
});

describe('index.html share tags', () => {
  it('has a meta description and a site-wide share card', () => {
    expect(html).toMatch(/<meta name="description" content="[^"]{50,160}" \/>/);
    expect(html).toContain('<meta property="og:site_name" content="BookaTurf" />');
    expect(html).toContain('<meta property="og:title" content="BookaTurf" />');
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
  });
});
