import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import { mockApi } from '../helpers/api';
import { setAccessToken } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import type { BookingJson, PublicUser } from '../../src/lib/types';

const player: PublicUser = { id: 'u1', name: 'Pat', email: 'p@x.com', emailVerified: true, phone: null, hasPassword: true, hasGoogle: false };

const review = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  stars: 4,
  comment: 'Nice',
  reviewer: 'Pat',
  createdAt: '2026-10-20T10:00:00.000Z',
  edited: false,
  reply: null,
  hidden: false,
  editableUntil: '2026-11-19T10:00:00.000Z',
  ...over,
});

const booking = (over: Partial<BookingJson> = {}) =>
  ({
    id: 'b1',
    reference: 'AB12CD',
    venueId: 'v1',
    turfId: 't1',
    businessDate: '2026-10-19',
    slots: [{ startAt: '2026-10-19T12:00:00.000Z', endAt: '2026-10-19T13:00:00.000Z', price: 1150 }],
    addons: [],
    currency: 'BDT',
    subtotal: 1150,
    addonsTotal: 0,
    total: 1150,
    advanceRequired: 1150,
    amountPaid: 1150,
    amountRefunded: 0,
    status: 'completed',
    paymentStatus: 'paid',
    holdExpiresAt: null,
    source: 'online',
    playerId: 'u1',
    guest: null,
    completedAt: '2026-10-19T13:00:00.000Z',
    review: null,
    reviewableUntil: '2026-11-18T13:00:00.000Z',
    venue: { slug: 'arena-one', name: 'Arena One', address: 'x', city: 'Dhaka', timezone: 'Asia/Dhaka' },
    turf: { name: 'Turf A' },
    ...over,
  }) as BookingJson;

const errBody = (code: string) => ({ error: { code, message: code } });

beforeEach(() => {
  setAccessToken(null);
  return i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('player review', () => {
  it('rate your game posts stars and comment', async () => {
    const api = mockApi([
      { method: 'POST', path: '/me/bookings/b1/review', status: 201, body: { review: review() } },
      { path: '/me/bookings/b1', body: { booking: booking(), refunds: [] } },
    ]);
    const { user } = renderApp('/me/bookings/b1', { user: player });
    await user.click(await screen.findByRole('button', { name: en.reviews.rate }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: en.reviews.submit });
    expect(submit).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: '4 stars' }));
    await user.type(within(dialog).getByLabelText(en.reviews.comment), 'Nice');
    expect(within(dialog).getByText('4/1000')).toBeInTheDocument();
    await user.click(submit);
    expect(await screen.findByText('Nice')).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ stars: 4, comment: 'Nice' });
    expect(screen.getByRole('img', { name: i18n.t('reviews.starsLabel', { value: 4 }) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.reviews.rate })).not.toBeInTheDocument();
  });

  it('?review=1 opens the dialog', async () => {
    mockApi([{ path: '/me/bookings/b1', body: { booking: booking(), refunds: [] } }]);
    renderApp('/me/bookings/b1?review=1', { user: player });
    expect(await screen.findByRole('dialog', { name: en.reviews.dialogTitle })).toBeInTheDocument();
  });

  it('?review=1 does not open when not reviewable', async () => {
    mockApi([{ path: '/me/bookings/b1', body: { booking: booking({ reviewableUntil: null }), refunds: [] } }]);
    renderApp('/me/bookings/b1?review=1', { user: player });
    await screen.findByText('Arena One');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('no rate button outside the window', async () => {
    mockApi([{ path: '/me/bookings/b1', body: { booking: booking({ reviewableUntil: null }), refunds: [] } }]);
    renderApp('/me/bookings/b1', { user: player });
    await screen.findByText('Arena One');
    expect(screen.queryByRole('button', { name: en.reviews.rate })).not.toBeInTheDocument();
  });

  it('edit and delete while editable; locked review has neither', async () => {
    const api = mockApi([
      { method: 'DELETE', path: '/me/bookings/b1/review', status: 204, body: null },
      { path: '/me/bookings/b1', body: { booking: booking({ reviewableUntil: null, review: review() as never }), refunds: [] } },
    ]);
    const { user } = renderApp('/me/bookings/b1', { user: player });
    expect(await screen.findByRole('button', { name: en.reviews.edit })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.reviews.delete }));
    const dialog = await screen.findByRole('dialog');
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: en.reviews.deleteConfirm }));
    await vi.waitFor(() => expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true));
    await vi.waitFor(() => expect(screen.queryByText('Nice')).not.toBeInTheDocument());
  });

  it('a locked review has no edit or delete', async () => {
    mockApi([
      { path: '/me/bookings/b1', body: { booking: booking({ reviewableUntil: null, review: review({ editableUntil: null }) as never }), refunds: [] } },
    ]);
    renderApp('/me/bookings/b1', { user: player });
    expect(await screen.findByText('Nice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.reviews.edit })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.reviews.delete })).not.toBeInTheDocument();
  });

  it('edit sends a PATCH and shows the edited mark and reply', async () => {
    const api = mockApi([
      { method: 'PATCH', path: '/me/bookings/b1/review', body: { review: review({ stars: 5, comment: 'Great', edited: true }) } },
      { path: '/me/bookings/b1', body: { booking: booking({ reviewableUntil: null, review: review({ reply: { text: 'Thanks!', at: '2026-10-21T00:00:00.000Z', editedAt: null } }) as never }), refunds: [] } },
    ]);
    const { user } = renderApp('/me/bookings/b1', { user: player });
    expect(await screen.findByText('Thanks!')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.reviews.edit }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: '5 stars' }));
    await user.click(within(dialog).getByRole('button', { name: en.reviews.save }));
    expect(await screen.findByText(en.reviews.edited)).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ stars: 5, comment: 'Nice' });
  });

  it('hidden review shows the moderation badge', async () => {
    mockApi([
      { path: '/me/bookings/b1', body: { booking: booking({ reviewableUntil: null, review: review({ hidden: true }) as never }), refunds: [] } },
    ]);
    renderApp('/me/bookings/b1', { user: player });
    expect(await screen.findByText(en.reviews.hidden)).toBeInTheDocument();
  });

  it('already_reviewed is shown translated in ru', async () => {
    await i18n.changeLanguage('ru');
    mockApi([
      { method: 'POST', path: '/me/bookings/b1/review', status: 409, body: errBody('already_reviewed') },
      { path: '/me/bookings/b1', body: { booking: booking(), refunds: [] } },
    ]);
    const { user } = renderApp('/me/bookings/b1', { user: player });
    await user.click(await screen.findByRole('button', { name: ru.reviews.rate }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: '4 звезды' }));
    await user.click(within(dialog).getByRole('button', { name: ru.reviews.submit }));
    expect(await within(dialog).findByText(ru.errors.already_reviewed)).toBeInTheDocument();
  });

  it('my bookings row shows the rate cue or my stars', async () => {
    mockApi([
      {
        path: '/me/bookings',
        body: {
          bookings: [
            booking({ id: 'a' }),
            booking({ id: 'c', reviewableUntil: null, review: review({ stars: 3 }) as never }),
          ],
        },
      },
    ]);
    renderApp('/me/bookings', { user: player });
    await screen.findByRole('tabpanel');
    await (await import('@testing-library/user-event')).default.setup().click(screen.getByRole('tab', { name: en.myBookings.past }));
    const links = within(screen.getByRole('tabpanel')).getAllByRole('link');
    expect(within(links[0]!).getByText(en.reviews.rateCue)).toBeInTheDocument();
    expect(within(links[1]!).getByRole('img', { name: i18n.t('reviews.starsLabel', { value: 3 }) })).toBeInTheDocument();
  });
});
