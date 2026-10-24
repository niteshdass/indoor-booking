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
        expect(out.sms).toContain('BK7Q2M');
      }
      expect(renderNotice(event, 'ru', data, appUrl).text).not.toBe(renderNotice(event, 'en', data, appUrl).text);
    }
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

  it('staff notice links to the dashboard, others to the booking page', () => {
    expect(renderNotice('staff_new_pending', 'en', data, appUrl).text).toContain('https://app.test/dashboard/bookings/b1');
    expect(renderNotice('booking_confirmed', 'en', data, appUrl).text).toContain('https://app.test/b/BK7Q2M');
  });
});
