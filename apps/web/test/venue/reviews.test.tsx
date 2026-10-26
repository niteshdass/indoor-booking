import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { PublicReviewJson } from '@booking/shared';
import i18n from '../../src/i18n';
import { mockApi, type Call } from '../helpers/api';
import { renderApp } from '../helpers/render';
import type { PublicVenue } from '../../src/lib/types';

const venue: PublicVenue = {
  slug: 'arena-one',
  name: 'Arena One',
  address: 'Road 1',
  city: 'Dhaka',
  country: 'BD',
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
  location: { lat: 1, lng: 2 },
  photos: [],
  amenities: [],
  turfs: [{ id: 't1', name: 'Court A', sports: ['futsal'], indoor: true, slotLengthMin: 60 }],
  rating: { average: 4.6, count: 23 },
};

const review = (id: string, over: Partial<PublicReviewJson> = {}): PublicReviewJson => ({
  id,
  stars: 5,
  comment: `Comment ${id}`,
  reviewer: 'Karim H.',
  createdAt: '2026-10-20T10:00:00.000Z',
  edited: false,
  reply: null,
  ...over,
});

const slots = { path: /\/venues\/arena-one\/turfs\/t1\/slots/, body: { day: { businessDate: '2026-10-25', currency: 'BDT', status: 'open', slots: [] } } };

beforeEach(() => i18n.changeLanguage('en'));
afterEach(() => vi.unstubAllGlobals());

describe('Venue reviews', () => {
  it('venue page shows average, count and reviews with replies', async () => {
    mockApi([
      { path: '/venues/arena-one', body: { venue } },
      {
        path: '/venues/arena-one/reviews',
        body: {
          reviews: [
            review('r1', {
              edited: true,
              reply: { text: 'Thanks for coming', at: '2026-10-21T10:00:00.000Z', editedAt: null },
            }),
          ],
          nextBefore: null,
        },
      },
      slots,
    ]);
    renderApp('/venues/arena-one?date=2026-10-25');
    const section = (await screen.findByRole('heading', { name: 'Reviews', level: 2 })).closest('section')!;
    expect(await within(section).findByText('Comment r1')).toBeInTheDocument();
    expect(within(section).getByText('4.6')).toBeInTheDocument();
    expect(within(section).getByText('23 reviews')).toBeInTheDocument();
    expect(within(section).getByRole('img', { name: '4.6 out of 5' })).toBeInTheDocument();
    expect(within(section).getByText('Karim H.')).toBeInTheDocument();
    expect(within(section).getByText('Edited')).toBeInTheDocument();
    expect(within(section).getByText('Reply from the venue')).toBeInTheDocument();
    expect(within(section).getByText('Thanks for coming')).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('show more loads the next page', async () => {
    const api = mockApi([
      { path: '/venues/arena-one', body: { venue } },
      {
        path: '/venues/arena-one/reviews',
        body: (call: Call) =>
          call.query.get('before') === 'cursor-1'
            ? { reviews: [review('r2')], nextBefore: null }
            : { reviews: [review('r1')], nextBefore: 'cursor-1' },
      },
      slots,
    ]);
    const { user } = renderApp('/venues/arena-one?date=2026-10-25');
    await screen.findByText('Comment r1');
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Comment r2')).toBeInTheDocument();
    expect(screen.getByText('Comment r1')).toBeInTheDocument();
    expect(api.calls.some((c) => c.query.get('before') === 'cursor-1')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('no reviews yet', async () => {
    mockApi([
      { path: '/venues/arena-one', body: { venue: { ...venue, rating: null } } },
      { path: '/venues/arena-one/reviews', body: { reviews: [], nextBefore: null } },
      slots,
    ]);
    renderApp('/venues/arena-one?date=2026-10-25');
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /out of 5/ })).not.toBeInTheDocument();
  });

  it('null reviewer shows Player', async () => {
    mockApi([
      { path: '/venues/arena-one', body: { venue } },
      { path: '/venues/arena-one/reviews', body: { reviews: [review('r1', { reviewer: null })], nextBefore: null } },
      slots,
    ]);
    renderApp('/venues/arena-one?date=2026-10-25');
    expect(await screen.findByText('Player')).toBeInTheDocument();
  });

  it('formats the average and count for Russian', async () => {
    await i18n.changeLanguage('ru');
    mockApi([
      { path: '/venues/arena-one', body: { venue } },
      { path: '/venues/arena-one/reviews', body: { reviews: [], nextBefore: null } },
      slots,
    ]);
    renderApp('/venues/arena-one?date=2026-10-25');
    expect(await screen.findByRole('heading', { name: 'Отзывы', level: 2 })).toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'Отзывы' });
    expect(within(section).getByText('4,6')).toBeInTheDocument();
    expect(within(section).getByText('23 отзыва')).toBeInTheDocument();
    expect(await screen.findByText('Пока нет отзывов')).toBeInTheDocument();
  });
});
