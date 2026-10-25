import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import { mockApi, type Call } from '../helpers/api';
import type { Permission } from '../../src/owner/types';
import { OWNER_ID, ownerReview, ownerRoutes, staffUser, venue } from './fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const R = en.owner.reviews;
const URL = `/owner/${OWNER_ID}/reviews`;
const venues = [venue(), venue({ id: 'v2', name: 'Arena Two', slug: 'arena-two' })];
const summary = [
  { venueId: 'v1', name: 'Arena One', rating: { average: 4.5, count: 2 } },
  { venueId: 'v2', name: 'Arena Two', rating: null },
];
const owner = (permissions: Permission[] = ['review.manage', 'booking.view']) => ownerRoutes({ permissions, venues });
const list = (reviews = [ownerReview()], nextBefore: string | null = null) => ({
  path: `/owners/${OWNER_ID}/reviews`,
  method: 'GET',
  body: { reviews, nextBefore, summary },
});

describe('owner Reviews page', () => {
  it('nav shows Reviews only with review.manage', async () => {
    mockApi([list(), ...owner(['review.manage'])]);
    const a = renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    const nav = await screen.findByRole('navigation', { name: en.owner.nav.label });
    expect(within(nav).getByRole('link', { name: en.owner.nav.reviews })).toBeTruthy();
    a.unmount();
    vi.unstubAllGlobals();
    mockApi([list(), ...ownerRoutes({ permissions: ['booking.view'], venues })]);
    renderApp(`/owner/${OWNER_ID}`, { user: staffUser });
    const nav2 = await screen.findByRole('navigation', { name: en.owner.nav.label });
    await screen.findAllByText(en.owner.nav.today);
    expect(within(nav2).queryByRole('link', { name: en.owner.nav.reviews })).toBeNull();
  });

  it('lists reviews with summary and filters; stars filter refetches with stars=5', async () => {
    const api = mockApi([
      {
        path: `/owners/${OWNER_ID}/reviews`,
        body: (call: Call) =>
          call.query.get('stars') === '5'
            ? { reviews: [ownerReview({ id: 'r5', stars: 5, comment: 'Perfect' })], nextBefore: null, summary }
            : { reviews: [ownerReview()], nextBefore: null, summary },
      },
      ...owner(),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    expect(await screen.findByText('Great pitch')).toBeTruthy();
    expect(screen.getByRole('heading', { name: R.title })).toBeTruthy();
    // Summary: rated venue and unrated venue.
    expect(screen.getByText('4.5')).toBeTruthy();
    expect(screen.getByText(en.reviews.none)).toBeTruthy();
    // Booking reference links to the booking when booking.view is held.
    expect(screen.getByRole('link', { name: 'BK-0001' }).getAttribute('href')).toBe(`/owner/${OWNER_ID}/bookings/b1`);
    expect(screen.getByText('Karim H.')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText(R.filterStars), '5');
    expect(await screen.findByText('Perfect')).toBeTruthy();
    expect(screen.queryByText('Great pitch')).toBeNull();
    expect(api.calls.some((c) => c.path === `/owners/${OWNER_ID}/reviews` && c.query.get('stars') === '5')).toBe(true);
    await user.selectOptions(screen.getByLabelText(R.filterVenue), 'v2');
    await screen.findByText('Perfect');
    expect(api.calls.some((c) => c.query.get('venueId') === 'v2' && c.query.get('stars') === '5')).toBe(true);
  });

  it('shows the booking reference as text without booking.view and pages with show more', async () => {
    const api = mockApi([
      {
        path: `/owners/${OWNER_ID}/reviews`,
        body: (call: Call) =>
          call.query.get('before') === 'r1'
            ? { reviews: [ownerReview({ id: 'r0', comment: 'Older one' })], nextBefore: null, summary }
            : { reviews: [ownerReview()], nextBefore: 'r1', summary },
      },
      ...owner(['review.manage']),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    await screen.findByText('Great pitch');
    expect(screen.queryByRole('link', { name: 'BK-0001' })).toBeNull();
    expect(screen.getByText('BK-0001')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: en.reviews.showMore }));
    expect(await screen.findByText('Older one')).toBeTruthy();
    expect(screen.getByText('Great pitch')).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.reviews.showMore })).toBeNull();
    expect(api.calls.filter((c) => c.path.endsWith('/reviews')).length).toBe(2);
  });

  it('reply create sends PUT with text and shows it; edit and delete work', async () => {
    const reply = (text: string) => ({ text, at: '2026-10-21T10:00:00.000Z', editedAt: null });
    const api = mockApi([
      list(),
      {
        method: 'PUT',
        path: `/owners/${OWNER_ID}/reviews/r1/reply`,
        body: (call: Call) => ({ review: ownerReview({ reply: reply((call.body as { text: string }).text) }) }),
      },
      { method: 'DELETE', path: `/owners/${OWNER_ID}/reviews/r1/reply`, status: 204, body: undefined },
      ...owner(),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    await screen.findByText('Great pitch');
    await user.click(screen.getByRole('button', { name: R.reply }));
    const field = screen.getByLabelText(R.replyField);
    expect(screen.getByText('0/1000')).toBeTruthy();
    await user.type(field, 'Thanks!');
    expect(screen.getByText('7/1000')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: R.replySave }));
    expect(await screen.findByText('Thanks!')).toBeTruthy();
    expect(api.calls.find((c) => c.method === 'PUT')!.body).toEqual({ text: 'Thanks!' });
    expect(screen.queryByLabelText(R.replyField)).toBeNull();
    // Edit
    await user.click(screen.getByRole('button', { name: R.replyEdit }));
    const edit = screen.getByLabelText(R.replyField) as HTMLTextAreaElement;
    expect(edit.value).toBe('Thanks!');
    await user.clear(edit);
    await user.type(edit, 'See you');
    await user.click(screen.getByRole('button', { name: R.replySave }));
    expect(await screen.findByText('See you')).toBeTruthy();
    // Delete asks first
    await user.click(screen.getByRole('button', { name: R.replyDelete }));
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: R.deleteConfirm }));
    await screen.findByRole('button', { name: R.reply });
    expect(screen.queryByText('See you')).toBeNull();
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('flag sends POST with reason and shows the flagged badge; no flag button on a flagged review', async () => {
    const api = mockApi([
      list([ownerReview(), ownerReview({ id: 'r2', comment: 'Already', flag: { at: '2026-10-21T10:00:00.000Z', reason: null } })]),
      {
        method: 'POST',
        path: `/owners/${OWNER_ID}/reviews/r1/flag`,
        body: { review: ownerReview({ flag: { at: '2026-10-22T10:00:00.000Z', reason: 'Spam' } }) },
      },
      ...owner(),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    await screen.findByText('Great pitch');
    // The already flagged review has a badge and no Flag button.
    expect(screen.getAllByText(R.flagged).length).toBe(1);
    expect(screen.getAllByRole('button', { name: R.flag }).length).toBe(1);
    await user.click(screen.getByRole('button', { name: R.flag }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(R.flagHint)).toBeTruthy();
    await user.type(within(dialog).getByLabelText(R.flagReason), 'Spam');
    expect(within(dialog).getByText('4/500')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: R.flagSubmit }));
    await vi.waitFor(() => expect(screen.getAllByText(R.flagged).length).toBe(2));
    expect(api.calls.find((c) => c.method === 'POST')!.body).toEqual({ reason: 'Spam' });
    expect(screen.queryByRole('button', { name: R.flag })).toBeNull();
  });

  it('shows a translated error when flagging is refused', async () => {
    mockApi([
      list(),
      {
        method: 'POST',
        path: `/owners/${OWNER_ID}/reviews/r1/flag`,
        status: 409,
        body: { error: { code: 'cannot_flag', message: 'x' } },
      },
      ...owner(),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    await screen.findByText('Great pitch');
    await user.click(screen.getByRole('button', { name: R.flag }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: R.flagSubmit }));
    expect(await screen.findByText(en.errors.cannot_flag)).toBeTruthy();
  });

  it('hidden review has no reply or flag actions', async () => {
    mockApi([list([ownerReview({ hidden: true }), ownerReview({ id: 'r3', comment: 'Kept', flagCleared: true })]), ...owner()]);
    renderApp(URL, { user: staffUser });
    await screen.findByText('Great pitch');
    expect(screen.getByText(R.hidden)).toBeTruthy();
    // Only the kept (cleared) review offers Reply; neither offers Flag.
    expect(screen.getAllByRole('button', { name: R.reply }).length).toBe(1);
    expect(screen.queryByRole('button', { name: R.flag })).toBeNull();
  });

  it('flag reason does not carry over to another review', async () => {
    const api = mockApi([
      list([ownerReview(), ownerReview({ id: 'r2', comment: 'Second' })]),
      { method: 'POST', path: `/owners/${OWNER_ID}/reviews/r2/flag`, body: { review: ownerReview({ id: 'r2', flag: { at: '2026-10-22T10:00:00.000Z', reason: null } }) } },
      ...owner(),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    await screen.findByText('Great pitch');
    await user.click(screen.getAllByRole('button', { name: R.flag })[0]!);
    await user.type(within(screen.getByRole('dialog')).getByLabelText(R.flagReason), 'Spam');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: R.cancel }));
    await user.click(screen.getAllByRole('button', { name: R.flag })[1]!);
    const field = within(screen.getByRole('dialog')).getByLabelText(R.flagReason) as HTMLTextAreaElement;
    expect(field.value).toBe('');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: R.flagSubmit }));
    await vi.waitFor(() => expect(api.calls.some((c) => c.method === 'POST')).toBe(true));
    expect(api.calls.find((c) => c.method === 'POST')!.body).toEqual({});
  });

  it('returning to a filter after Show more does not keep stale pages', async () => {
    mockApi([
      {
        path: `/owners/${OWNER_ID}/reviews`,
        body: (call: Call) =>
          call.query.get('stars') === '5'
            ? { reviews: [ownerReview({ id: 'r5', comment: 'Perfect' })], nextBefore: null, summary }
            : call.query.get('before') === 'r1'
              ? { reviews: [ownerReview({ id: 'r0', comment: 'Older one' })], nextBefore: null, summary }
              : { reviews: [ownerReview()], nextBefore: 'r1', summary },
      },
      ...owner(),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    await screen.findByText('Great pitch');
    await user.click(screen.getByRole('button', { name: en.reviews.showMore }));
    await screen.findByText('Older one');
    await user.selectOptions(screen.getByLabelText(R.filterStars), '5');
    await screen.findByText('Perfect');
    await user.selectOptions(screen.getByLabelText(R.filterStars), '');
    await screen.findByText('Great pitch');
    expect(screen.queryByText('Older one')).toBeNull();
    expect(screen.getByRole('button', { name: en.reviews.showMore })).toBeTruthy();
  });

  it('renders in Russian', async () => {
    await i18n.changeLanguage('ru');
    mockApi([list([ownerReview({ flag: { at: '2026-10-21T10:00:00.000Z', reason: null } })]), ...owner()]);
    const { user } = renderApp(URL, { user: staffUser });
    await screen.findByText('Great pitch');
    expect(screen.getByRole('heading', { name: ru.owner.reviews.title })).toBeTruthy();
    expect(screen.getByText(ru.owner.reviews.flagged)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: ru.owner.reviews.reply }));
    expect(screen.getByLabelText(ru.owner.reviews.replyField)).toBeTruthy();
    expect(screen.getByText(ru.owner.reviews.replyCount.replace('{{n}}', '0'))).toBeTruthy();
  });
});
