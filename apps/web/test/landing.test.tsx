import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en.json';
import { renderApp } from './helpers/render';
import { mockApi } from './helpers/api';

beforeEach(async () => {
  mockApi([{ path: '/search', body: { results: [], nextCursor: null } }]);
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('landing page', () => {
  it('shows the hero and links each sport to a filtered search', () => {
    renderApp('/');
    expect(screen.getByRole('heading', { level: 1, name: en.landing.title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(en.sports.padel) })).toHaveAttribute('href', '/search?sport=padel&available=true');
    for (const a of screen.getAllByRole('link', { name: en.landing.owners.cta })) expect(a).toHaveAttribute('href', '/list-your-venue');
  });

  it('shows only the sports the platform offers, in its order', async () => {
    mockApi([{ path: '/sports', body: { sports: ['cricket', 'football'] } }]);
    renderApp('/');
    const tiles = within(screen.getByRole('region', { name: en.landing.sports.title }));
    await waitFor(() => expect(tiles.getAllByRole('link')).toHaveLength(2));
    expect(tiles.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/search?sport=cricket&available=true',
      '/search?sport=football&available=true',
    ]);
    const select = screen.getByLabelText(en.search.sport);
    expect(within(select).getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(['', 'cricket', 'football']);
  });

  it('hero search goes to /search with the chosen sport and date', async () => {
    const { user, location } = renderApp('/');
    expect(screen.getByRole('form', { name: en.landing.searchLabel })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(en.search.sport), 'tennis');
    await user.type(screen.getByLabelText(en.search.date), '2026-11-02');
    await user.click(screen.getByRole('button', { name: en.landing.submit }));
    await waitFor(() => expect(location().pathname).toBe('/search'));
    expect(location().search).toBe('?sport=tennis&date=2026-11-02&available=true');
  });
});
