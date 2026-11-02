import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { apiDownload, ApiError, filenameFrom, setAccessToken, setRefreshHandler } from '../../src/lib/apiClient';
import { activityLabel } from '../../src/owner/activity/activityText';
import { exportPath, initialRange, rangeErrors } from '../../src/owner/export/exportRange';
import { renderApp } from '../helpers/render';
import { mockApi, type Call, type Route } from '../helpers/api';
import { activityItem, OWNER_ID, ownerRoutes, staffUser, turf, venue } from './fixtures';
import type { Permission } from '../../src/owner/types';

const NOW = '2026-10-26T20:30:00.000Z'; // already 2026-10-27 in Dhaka
const E = en.owner.export;

let clicked: { href: string; download: string }[] = [];
const created = vi.fn((_b: Blob) => 'blob:export');
const revoked = vi.fn();

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  clicked = [];
  // jsdom has no object URLs and does not navigate; record what would be saved instead.
  Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  created.mockClear();
  revoked.mockClear();
  setAccessToken(null);
  setRefreshHandler(null);
});

const csvPath = /^\/owners\/o1\/reports\/(bookings|payments)\.csv$/;

function bookingsRoutes(permissions: Permission[], extra: Route[] = [], venues = [venue()]): Route[] {
  return [
    ...extra,
    ...ownerRoutes({ permissions, venues }),
    { path: /^\/owners\/o1\/venues\/v\d\/turfs$/, body: { turfs: [turf()] } },
    { path: '/owners/o1/bookings', body: { bookings: [], total: 0 } },
  ];
}

const openDialog = async (user: ReturnType<typeof renderApp>['user']) => {
  await user.click(await screen.findByRole('button', { name: E.button }));
  return screen.findByRole('dialog');
};

describe('export range', () => {
  it('opens on the page range, else the last 30 days to today', () => {
    expect(initialRange('2026-10-27')).toEqual({ from: '2026-09-28', to: '2026-10-27' });
    expect(initialRange('2026-10-27', { days: 7 })).toEqual({ from: '2026-10-21', to: '2026-10-27' });
    expect(initialRange('2026-10-27', { from: '2026-10-01', to: '2026-10-05' })).toEqual({ from: '2026-10-01', to: '2026-10-05' });
    expect(initialRange('2026-10-27', { from: '2026-10-01' })).toEqual({ from: '2026-10-01', to: '2026-10-27' });
    expect(initialRange('2026-10-27', { to: '2026-10-10' })).toEqual({ from: '2026-09-11', to: '2026-10-10' });
  });

  it('refuses an end before the start, more than 366 days and missing dates', () => {
    expect(rangeErrors({ from: '2026-10-01', to: '2026-10-01' })).toEqual({});
    expect(rangeErrors({ from: '2026-10-02', to: '2026-10-01' })).toEqual({ to: 'owner.export.err.order' });
    expect(rangeErrors({ from: '2025-10-27', to: '2026-10-27' })).toEqual({}); // 366 days
    expect(rangeErrors({ from: '2025-10-26', to: '2026-10-27' })).toEqual({ to: 'owner.export.err.tooLong' });
    expect(rangeErrors({ from: '', to: '2026-10-27' })).toEqual({ from: 'owner.export.err.date' });
  });

  it('builds the CSV path, leaving out the venue for all venues', () => {
    expect(exportPath('o1', 'payments', 'v1', { from: '2026-10-01', to: '2026-10-31' })).toBe(
      '/owners/o1/reports/payments.csv?venueId=v1&from=2026-10-01&to=2026-10-31',
    );
    expect(exportPath('o1', 'bookings', null, { from: '2026-10-01', to: '2026-10-31' })).toBe('/owners/o1/reports/bookings.csv?from=2026-10-01&to=2026-10-31');
  });
});

describe('apiDownload', () => {
  it('returns the blob with the Content-Disposition filename and sends the token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('﻿Reference\r\nBK-1\r\n', {
        status: 200,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bookings-arena-one-2026-10-01-to-2026-10-31.csv"' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('abc');
    const file = await apiDownload('/owners/o1/reports/bookings.csv?from=2026-10-01&to=2026-10-31');
    expect(file.filename).toBe('bookings-arena-one-2026-10-01-to-2026-10-31.csv');
    expect(await file.blob.text()).toContain('BK-1');
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('authorization')).toBe('Bearer abc');
  });

  it('throws ApiError from a JSON error body', async () => {
    mockApi([{ path: '/owners/o1/reports/bookings.csv', status: 400, body: { error: { code: 'export_too_large', message: 'Too many', details: { max: 50000 } } } }]);
    const err = await apiDownload('/owners/o1/reports/bookings.csv?from=2026-01-01&to=2026-10-31').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'export_too_large', details: { max: 50000 } });
  });

  it('refreshes once on a 401 and retries', async () => {
    const { calls } = mockApi([
      {
        path: '/owners/o1/reports/payments.csv',
        body: (_c: Call, n: number) => (n === 0 ? { status: 401, body: { error: { code: 'invalid_token', message: 'x' } } } : {}),
      },
    ]);
    setAccessToken('old');
    setRefreshHandler(async () => 'fresh');
    await apiDownload('/owners/o1/reports/payments.csv?from=2026-10-01&to=2026-10-31');
    expect(calls.map((c) => c.headers.get('authorization'))).toEqual(['Bearer old', 'Bearer fresh']);
  });

  it('reads plain and RFC 5987 filenames', () => {
    expect(filenameFrom('attachment; filename="a b.csv"')).toBe('a b.csv');
    expect(filenameFrom('attachment; filename=plain.csv')).toBe('plain.csv');
    expect(filenameFrom("attachment; filename=\"x.csv\"; filename*=UTF-8''%D0%B0.csv")).toBe('а.csv');
    expect(filenameFrom(null)).toBeNull();
  });
});

describe('export dialog', () => {
  it('is hidden without reports.view', async () => {
    mockApi(bookingsRoutes(['booking.view']));
    renderApp(`/owner/${OWNER_ID}/bookings`, { user: staffUser });
    expect(await screen.findByText(en.owner.bookings.empty)).toBeTruthy();
    expect(screen.queryByRole('button', { name: E.button })).toBeNull();
  });

  it('downloads bookings for the page venue and range, then closes', async () => {
    const api = mockApi(bookingsRoutes(['booking.view', 'reports.view'], [{ path: csvPath, body: {} }]));
    const { user } = renderApp(`/owner/${OWNER_ID}/bookings?from=2026-10-01&to=2026-10-15`, { user: staffUser });
    const dialog = await openDialog(user);
    expect(within(dialog).getByLabelText(E.from)).toHaveValue('2026-10-01');
    expect(within(dialog).getByLabelText(E.to)).toHaveValue('2026-10-15');
    expect(within(dialog).getByRole('radio', { name: new RegExp(E.kind.bookings) })).toBeChecked();
    expect(within(dialog).getByText(E.note)).toBeTruthy();
    // One venue: nothing to pick.
    expect(within(dialog).queryByLabelText(en.owner.venue)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: E.download }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const call = api.calls.find((c) => csvPath.test(c.path))!;
    expect(call.path).toBe('/owners/o1/reports/bookings.csv');
    expect(Object.fromEntries(call.query)).toEqual({ venueId: 'v1', from: '2026-10-01', to: '2026-10-15' });
    expect(created).toHaveBeenCalledOnce();
    expect(clicked).toEqual([{ href: 'blob:export', download: 'bookings.csv' }]);
    await waitFor(() => expect(revoked).toHaveBeenCalledWith('blob:export'));
  });

  it('defaults to the last 30 days in venue time and exports payments for all venues', async () => {
    const api = mockApi(bookingsRoutes(['booking.view', 'reports.view'], [{ path: csvPath, body: {} }], [venue(), venue({ id: 'v2', name: 'Arena Two' })]));
    const { user } = renderApp(`/owner/${OWNER_ID}/bookings`, { user: staffUser });
    const dialog = await openDialog(user);
    expect(within(dialog).getByLabelText(E.from)).toHaveValue('2026-09-28');
    expect(within(dialog).getByLabelText(E.to)).toHaveValue('2026-10-27');
    const select = within(dialog).getByLabelText(en.owner.venue);
    expect(select).toHaveValue('v1');
    await user.selectOptions(select, '');
    await user.click(within(dialog).getByRole('radio', { name: new RegExp(E.kind.payments) }));
    await user.click(within(dialog).getByRole('button', { name: E.download }));
    await waitFor(() => expect(api.calls.some((c) => csvPath.test(c.path))).toBe(true));
    const call = api.calls.find((c) => csvPath.test(c.path))!;
    expect(call.path).toBe('/owners/o1/reports/payments.csv');
    expect(Object.fromEntries(call.query)).toEqual({ from: '2026-09-28', to: '2026-10-27' });
  });

  it('shows inline errors and sends nothing for a bad range', async () => {
    const api = mockApi(bookingsRoutes(['booking.view', 'reports.view'], [{ path: csvPath, body: {} }]));
    const { user } = renderApp(`/owner/${OWNER_ID}/bookings`, { user: staffUser });
    const dialog = await openDialog(user);
    fireEvent.change(within(dialog).getByLabelText(E.from), { target: { value: '2026-10-20' } });
    fireEvent.change(within(dialog).getByLabelText(E.to), { target: { value: '2026-10-10' } });
    await user.click(within(dialog).getByRole('button', { name: E.download }));
    expect(within(dialog).getByText(E.err.order)).toBeTruthy();
    expect(within(dialog).getByLabelText(E.to)).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(within(dialog).getByLabelText(E.from), { target: { value: '2025-01-01' } });
    expect(within(dialog).getByText(E.err.tooLong.replace('{{max}}', '366'))).toBeTruthy();
    expect(api.calls.some((c) => csvPath.test(c.path))).toBe(false);
  });

  it('shows the server error and stays open', async () => {
    mockApi(
      bookingsRoutes(['booking.view', 'reports.view'], [
        { path: csvPath, status: 400, body: { error: { code: 'export_too_large', message: 'More than 50000 rows', details: { max: 50000 } } } },
      ]),
    );
    const { user } = renderApp(`/owner/${OWNER_ID}/bookings`, { user: staffUser });
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: E.download }));
    expect(await within(dialog).findByText(en.errors.export_too_large)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(clicked).toEqual([]);
  });

  it('opens on the overview period', async () => {
    const api = mockApi([
      { path: csvPath, body: {} },
      { path: `/owners/${OWNER_ID}/reports/overview`, status: 500, body: { error: { code: 'internal', message: 'x' } } },
      ...ownerRoutes({ permissions: ['booking.view', 'reports.view'] }),
    ]);
    const { user } = renderApp(`/owner/${OWNER_ID}/overview?days=7`, { user: staffUser });
    const dialog = await openDialog(user);
    expect(within(dialog).getByLabelText(E.from)).toHaveValue('2026-10-21');
    expect(within(dialog).getByLabelText(E.to)).toHaveValue('2026-10-27');
    await user.click(within(dialog).getByRole('button', { name: E.download }));
    await waitFor(() => expect(api.calls.some((c) => csvPath.test(c.path))).toBe(true));
    expect(api.calls.find((c) => csvPath.test(c.path))!.query.get('venueId')).toBe('v1');
  });
});

describe('activity', () => {
  it('labels a report export', () => {
    const item = activityItem({ action: 'report.exported', entity: 'report', after: { kind: 'bookings', from: '2026-10-01', to: '2026-10-31', rows: 12 } });
    expect(activityLabel(item, i18n.t)).toBe(en.owner.activity.action.report_exported);
  });
});
