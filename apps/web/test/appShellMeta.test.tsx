import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en.json';
import { SkipLink } from '../src/components/SkipLink';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';

const root = resolve(__dirname, '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});

describe('skip link', () => {
  it('is the first tab stop and moves focus to <main>', async () => {
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <SkipLink />
        <nav>
          <a href="/x">Nav</a>
        </nav>
        <main>Content</main>
      </I18nextProvider>,
    );
    await user.tab();
    const link = screen.getByRole('link', { name: en.nav.skip });
    expect(link).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
  });
});

describe('installable app head', () => {
  it('links a manifest whose icons ship in public/', () => {
    const href = /<link rel="manifest" href="\/([^"]+)"/.exec(html)?.[1];
    expect(href).toBeTruthy();
    const manifest = JSON.parse(readFileSync(resolve(root, 'public', href!), 'utf8')) as { name: string; icons: { src: string; sizes: string }[] };
    expect(manifest.name).toBe('BookaTurf');
    expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const icon of manifest.icons) expect(existsSync(resolve(root, 'public', icon.src.slice(1))), icon.src).toBe(true);
  });

  it('has an apple-touch-icon and a theme-color per colour scheme', () => {
    const touch = /<link rel="apple-touch-icon" href="\/([^"]+)"/.exec(html)?.[1];
    expect(touch && existsSync(resolve(root, 'public', touch))).toBe(true);
    expect(html).toMatch(/<meta name="theme-color" content="#[0-9a-f]{6}" media="\(prefers-color-scheme: light\)"/);
    expect(html).toMatch(/<meta name="theme-color" content="#[0-9a-f]{6}" media="\(prefers-color-scheme: dark\)"/);
  });
});

describe('theme-color follows a picked theme', () => {
  function Pick({ to }: { to: 'dark' | 'system' }) {
    const { setTheme } = useTheme();
    return <button onClick={() => setTheme(to)}>{to}</button>;
  }

  it('drops the media split while a theme is picked and restores it on system', async () => {
    document.head.insertAdjacentHTML(
      'beforeend',
      '<meta name="theme-color" content="#fbfbfa" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0f1317" media="(prefers-color-scheme: dark)">',
    );
    document.documentElement.style.setProperty('--bg-page', '#0f1317');
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Pick to="dark" />
        <Pick to="system" />
      </ThemeProvider>,
    );
    const metas = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    await user.click(screen.getByRole('button', { name: 'dark' }));
    expect(metas().map((m) => [m.getAttribute('media'), m.getAttribute('content')])).toEqual([
      ['all', '#0f1317'],
      ['all', '#0f1317'],
    ]);
    await user.click(screen.getByRole('button', { name: 'system' }));
    expect(metas().map((m) => m.getAttribute('media'))).toEqual(['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']);
    expect(metas().map((m) => m.getAttribute('content'))).toEqual(['#fbfbfa', '#0f1317']);
    for (const m of metas()) m.remove();
    document.documentElement.style.removeProperty('--bg-page');
  });
});
