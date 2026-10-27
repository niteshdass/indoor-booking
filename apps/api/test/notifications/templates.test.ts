import { describe, expect, it } from 'vitest';
import { formatMoney, LOCALES } from '@booking/shared';
import { NOTICE_EVENTS, renderNotice, type NoticeData } from '../../src/notifications/templates';

const appUrl = 'https://app.test';
const data: NoticeData = {
  bookingId: 'b1',
  reference: 'BK7Q2M',
  venueName: 'Arena',
  turfName: 'Court 1',
  timezone: 'Asia/Dhaka',
  startAt: '2026-11-10T17:00:00.000Z',
  endAt: '2026-11-10T18:00:00.000Z',
  currency: 'BDT',
  customerName: 'Rahim',
  holdExpiresAt: '2026-11-10T16:30:00.000Z',
};

describe('notification templates', () => {
  it('every event renders a subject, text and sms in both locales', () => {
    for (const event of NOTICE_EVENTS) {
      for (const l of LOCALES) {
        const out = renderNotice(event, l, data, appUrl);
        expect(out.subject).not.toBe('');
        expect(out.text).toContain('BK7Q2M');
        // The review_request sms is link-only by design.
        if (event !== 'review_request') expect(out.sms).toContain('BK7Q2M');
      }
      expect(renderNotice(event, 'ru', data, appUrl).text).not.toBe(renderNotice(event, 'en', data, appUrl).text);
    }
  });

  it('the confirmation sms names the venue, court and local start', () => {
    const en = renderNotice('booking_confirmed', 'en', data, appUrl).sms;
    const ru = renderNotice('booking_confirmed', 'ru', data, appUrl).sms;
    expect(en).toBe('Booking confirmed: Arena, Court 1, Nov 10, 2026, 11:00 PM. BK7Q2M https://app.test/b/BK7Q2M');
    expect(ru).toContain('Бронирование подтверждено: Arena, Court 1,');
    expect(ru).toContain('23:00');
  });

  it('times are shown in the venue timezone', () => {
    const en = renderNotice('booking_confirmed', 'en', data, appUrl).text;
    const ru = renderNotice('booking_confirmed', 'ru', data, appUrl).text;
    expect(en).toContain('11:00 PM');
    expect(ru).toContain('23:00');
    expect(en).not.toContain('17:00');
    expect(ru).not.toContain('17:00');
  });

  it('refund amounts are formatted in the booking currency', () => {
    const text = renderNotice('refund_issued', 'en', { ...data, amount: 150000 }, appUrl).text;
    expect(text).toContain(formatMoney(150000, 'BDT', 'en'));
  });

  it('cancelled without a refund has no refund line', () => {
    expect(renderNotice('booking_cancelled', 'en', { ...data, amount: 0 }, appUrl).text).not.toContain('Refund');
    expect(renderNotice('booking_cancelled', 'en', { ...data, amount: 5000 }, appUrl).text).toContain('Refund: ');
  });

  it('rejected includes the reason when given', () => {
    expect(renderNotice('booking_rejected', 'en', { ...data, reason: 'Pitch flooded' }, appUrl).text).toContain('Pitch flooded');
  });

  it('an auto-reject says the venue did not confirm in time, with no reason line', () => {
    const auto = { ...data, autoRejected: true };
    const en = renderNotice('booking_rejected', 'en', auto, appUrl);
    expect(en.text).toContain('The venue did not confirm your request in time.');
    for (const s of [en.subject, en.text, en.sms]) expect(s).not.toMatch(/declined/i);
    expect(en.text).not.toContain('Reason');
    expect(renderNotice('booking_rejected', 'ru', auto, appUrl).text).toContain('Площадка не подтвердила заявку вовремя.');
  });

  it('a ru auto-reject has no Latin text besides the reference and link', () => {
    // Venue and turf names are the owner's own text; give them Russian ones here.
    const auto = { ...data, venueName: 'Арена', turfName: 'Корт 1', autoRejected: true };
    const ru = renderNotice('booking_rejected', 'ru', auto, appUrl);
    for (const s of [ru.subject, ru.text, ru.sms]) {
      const rest = s.replaceAll(`${appUrl}/b/${data.reference}`, '').replaceAll(data.reference, '');
      expect(rest).not.toMatch(/[A-Za-z]/);
    }
    expect(ru.text).not.toContain('Причина');
    expect(ru.text).not.toContain('отклонила');
  });

  it('staff notice links to the dashboard, others to the booking page', () => {
    expect(renderNotice('staff_new_pending', 'en', data, appUrl).text).toContain('https://app.test/dashboard/bookings/b1');
    expect(renderNotice('booking_confirmed', 'en', data, appUrl).text).toContain('https://app.test/b/BK7Q2M');
  });

  it('review_request links to the booking with the review dialog open', () => {
    for (const l of LOCALES) {
      expect(renderNotice('review_request', l, data, appUrl).text).toContain('/me/bookings/b1?review=1');
    }
  });

  it('review_posted links to the owner reviews page and quotes the comment', () => {
    const d = { ...data, ownerId: 'o1', stars: 4, comment: 'Great lights' };
    const en = renderNotice('review_posted', 'en', d, appUrl);
    const ru = renderNotice('review_posted', 'ru', d, appUrl);
    expect(en.text).toContain('/owner/o1/reviews');
    expect(en.text).toContain('"Great lights"');
    expect(ru.text).toContain('«Great lights»');
    expect(en.subject).toBe('New review: 4 of 5 (BK7Q2M)');
  });
});
