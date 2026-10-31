import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import type { PublicUser } from '../../src/lib/types';
import { docsEn } from '../../src/admin/docs/content';
import { docsRu } from '../../src/admin/docs/content.ru';
import { mockApi } from '../helpers/api';
import { renderApp } from '../helpers/render';
import { staffUser } from '../owner/fixtures';

const admin: PublicUser = { ...staffUser, id: 'u-admin', name: 'Ada Admin', platformAdmin: true };
const ME = { role: { key: 'super_admin', name: 'Super Admin' }, permissions: ['platform.view', 'platform.settings'] };
const d = en.admin.docs;
const topic = (id: string) => docsEn.topics.find((tp) => tp.id === id)!;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

describe('admin docs', () => {
  it('opens from the admin nav in a new tab', async () => {
    mockApi([{ path: '/admin/me', body: ME }, { path: '/admin/overview', status: 500, body: {} }]);
    renderApp('/admin', { user: admin });
    const link = await screen.findByRole('link', { name: new RegExp(en.admin.nav.docs) });
    expect(link).toHaveAttribute('href', '/admin/docs');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows the topic sidebar grouped by subject and goes to the first topic', async () => {
    mockApi([{ path: '/admin/me', body: ME }]);
    const h = renderApp('/admin/docs', { user: admin });
    const nav = await screen.findByRole('navigation', { name: d.topics });
    expect(h.location().pathname).toBe('/admin/docs/overview');
    for (const label of Object.values(docsEn.groups)) expect(within(nav).getByText(label)).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: topic('overview').title })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('navigation', { name: en.admin.nav.label })).not.toBeInTheDocument();
  });

  it('links the Google topic to the Google tab, not the default General tab', async () => {
    mockApi([{ path: '/admin/me', body: ME }]);
    renderApp('/admin/docs/google', { user: admin });
    expect(await screen.findByRole('heading', { level: 1, name: topic('google').title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: d.openSettings })).toHaveAttribute('href', '/admin/settings?section=google');
  });

  it('renders a topic with its sections, settings link, links and next topic', async () => {
    mockApi([{ path: '/admin/me', body: ME }]);
    const h = renderApp('/admin/docs/email', { user: admin });
    expect(await screen.findByRole('heading', { level: 1, name: topic('email').title })).toBeInTheDocument();
    for (const sec of topic('email').sections) expect(screen.getByRole('heading', { level: 2, name: sec.title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: d.openSettings })).toHaveAttribute('href', '/admin/settings?section=email');
    expect(screen.getByRole('link', { name: 'app password' })).toHaveAttribute('target', '_blank');
    expect(screen.getAllByText('smtp.gmail.com', { selector: 'code' }).length).toBeGreaterThan(0);

    const pager = screen.getByRole('navigation', { name: d.pager });
    await h.user.click(within(pager).getByRole('link', { name: (n) => n.includes(topic('sms').title) }));
    expect(h.location().pathname).toBe('/admin/docs/sms');
    expect(await screen.findByRole('heading', { level: 1, name: topic('sms').title })).toBeInTheDocument();
  });

  it.each([
    ['en', docsEn],
    ['ru', docsRu],
  ] as const)('has a General topic linked to the General tab (%s)', async (lang, docs) => {
    await i18n.changeLanguage(lang);
    const general = docs.topics.find((tp) => tp.id === 'general')!;
    expect(general.settings).toBe('general');
    mockApi([{ path: '/admin/me', body: ME }]);
    renderApp('/admin/docs/general', { user: admin });
    expect(await screen.findByRole('heading', { level: 1, name: general.title })).toBeInTheDocument();
    for (const sec of general.sections) expect(screen.getByRole('heading', { level: 2, name: sec.title })).toBeInTheDocument();
    const settingsLabel = (lang === 'en' ? en : ru).admin.docs.openSettings;
    expect(screen.getByRole('link', { name: settingsLabel })).toHaveAttribute('href', '/admin/settings?section=general');
    const text = document.body.textContent ?? '';
    expect(text).toContain('/api/v1/webhooks/stripe/platform');
    expect(text).toMatch(/1[,.\s ]?000/);
    expect(text).toMatch(/1[,.\s ]?050/);
  });

  it('the General topic covers approval, fee modes, who pays, payouts and walk-ins', () => {
    const body = JSON.stringify(topic('general'));
    for (const word of ['Automatic', 'Free', 'Fixed', 'Percent', '50%', 'Court', 'bKash', 'Nagad', 'Stripe', 'Payouts', 'Reject', 'Owes', 'credit', 'walk-in']) {
      expect(body).toContain(word);
    }
    expect(body).not.toContain('Field');
  });

  it('sends an unknown topic to the overview', async () => {
    mockApi([{ path: '/admin/me', body: ME }]);
    const h = renderApp('/admin/docs/nope', { user: admin });
    expect(await screen.findByRole('heading', { level: 1, name: topic('overview').title })).toBeInTheDocument();
    expect(h.location().pathname).toBe('/admin/docs/overview');
  });

  it('follows the app language', async () => {
    await i18n.changeLanguage('ru');
    mockApi([{ path: '/admin/me', body: ME }]);
    renderApp('/admin/docs/google', { user: admin });
    expect(await screen.findByRole('heading', { level: 1, name: docsRu.topics.find((tp) => tp.id === 'google')!.title })).toBeInTheDocument();
  });

  it('has the same topics and sections in every language', () => {
    expect(docsRu.topics.map((tp) => [tp.id, tp.group, tp.settings, tp.sections.map((s) => s.id)])).toEqual(
      docsEn.topics.map((tp) => [tp.id, tp.group, tp.settings, tp.sections.map((s) => s.id)]),
    );
  });
});
