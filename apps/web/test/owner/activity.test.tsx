import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import i18n from '../../src/i18n';
import { setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { activityLabel, changedKeys } from '../../src/owner/activity/activityText';
import { renderApp } from '../helpers/render';
import { mockApi, type Call } from '../helpers/api';
import { OWNER_ID, activityItem, ownerRoutes, staffUser } from './fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshHandler(null);
});

const A = en.owner.activity;
const URL = `/owner/${OWNER_ID}/activity`;
const routes = () => ownerRoutes({ permissions: ['reports.view'] });

describe('activityText', () => {
  it('activityLabel translates known actions and falls back for unknown', () => {
    const t = i18n.t.bind(i18n);
    expect(activityLabel(activityItem({ action: 'booking.no_show' }), t)).toBe(A.action.booking_no_show);
    expect(activityLabel(activityItem({ action: 'payment_gateway.connect' }), t)).toBe(A.action.payment_gateway_connect);
    expect(activityLabel(activityItem({ action: 'thing.explode' }), t)).toBe(A.action.unknown.replace('{{action}}', 'thing.explode'));
  });

  it('changedKeys lists differing top-level keys', () => {
    expect(changedKeys({ b: 1, a: 1, c: { x: 1 } }, { a: 2, b: 1, c: { x: 1 }, d: 4 })).toEqual(['a', 'd']);
    expect(changedKeys(null, { z: 1, y: 2 })).toEqual(['y', 'z']);
    expect(changedKeys({ a: 1 }, null)).toEqual(['a']);
    expect(changedKeys(null, null)).toEqual([]);
  });
});

describe('ActivityPage', () => {
  it('load more appends the next page and hides at the end', async () => {
    mockApi([
      {
        path: '/owners/o1/activity',
        body: (call: Call) =>
          call.query.get('before') === 'a1'
            ? { items: [activityItem({ id: 'a0', action: 'role.create', entity: 'role' })], nextBefore: null }
            : { items: [activityItem({ id: 'a1' })], nextBefore: 'a1' },
      },
      ...routes(),
    ]);
    const { user } = renderApp(URL, { user: staffUser });
    expect(await screen.findByText(A.action.turf_update)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: A.loadMore }));
    expect(await screen.findByText(A.action.role_create)).toBeTruthy();
    expect(screen.getByText(A.action.turf_update)).toBeTruthy();
    expect(screen.queryByRole('button', { name: A.loadMore })).toBeNull();
  });

  it('shows the venue time zone, the actor and the system fallback', async () => {
    mockApi([
      {
        path: '/owners/o1/activity',
        body: {
          items: [activityItem({ id: 'a2', actor: null, action: 'booking.expired', entity: 'booking', entityId: 'b9' }), activityItem()],
          nextBefore: null,
        },
      },
      ...routes(),
    ]);
    renderApp(URL, { user: staffUser });
    const table = within(await screen.findByRole('table'));
    expect(table.getByText('Sam Staff')).toBeTruthy();
    expect(table.getByText(A.system)).toBeTruthy();
    // 20:30Z is 02:30 the next morning in Asia/Dhaka (+06).
    expect(table.getAllByText(/02:30/).length).toBe(2);
  });

  it('review actions and entity render translated in ru', async () => {
    await i18n.changeLanguage('ru');
    const actions = ['review.posted', 'review.replied', 'review.reply_deleted', 'review.flagged'];
    mockApi([
      {
        path: '/owners/o1/activity',
        body: { items: actions.map((action, i) => activityItem({ id: `r${i}`, action, entity: 'review', entityId: `rv${i}` })), nextBefore: null },
      },
      ...routes(),
    ]);
    renderApp(URL, { user: staffUser });
    const table = within(await screen.findByRole('table'));
    const R = ru.owner.activity;
    for (const k of ['review_posted', 'review_replied', 'review_reply_deleted', 'review_flagged'] as const) {
      expect(R.action[k]).toBeTruthy();
      expect(table.getByText(R.action[k])).toBeTruthy();
    }
    expect(table.getAllByText(R.entity.review)).toHaveLength(4);
    expect(table.queryByText(/review/)).toBeNull();
  });

  it('booking entries link to the booking detail', async () => {
    mockApi([
      {
        path: '/owners/o1/activity',
        body: { items: [activityItem({ action: 'booking.confirmed', entity: 'booking', entityId: 'b9' })], nextBefore: null },
      },
      ...routes(),
    ]);
    renderApp(URL, { user: staffUser });
    const link = await screen.findByRole('link', { name: A.openBooking });
    expect(link.getAttribute('href')).toBe(`/owner/${OWNER_ID}/bookings/b9`);
  });

  it('before/after render as text', async () => {
    mockApi([
      {
        path: '/owners/o1/activity',
        body: {
          items: [activityItem({ before: { name: 'Old' }, after: { name: '<script>alert(1)</script>' } })],
          nextBefore: null,
        },
      },
      ...routes(),
    ]);
    const { container } = renderApp(URL, { user: staffUser });
    await screen.findByText(A.action.turf_update);
    expect(container.querySelector('script')).toBeNull();
    const pre = screen.getAllByText(/<script>alert\(1\)<\/script>/);
    expect(pre[0]!.tagName).toBe('PRE');
    expect(within(pre[0]!.closest('details')!).getByText(/"Old"/)).toBeTruthy();
    // The only changed key is shown in the row.
    expect(screen.getAllByText('name').length).toBeGreaterThan(0);
  });
});
