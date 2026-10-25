import { formatMoney, type Locale } from '@booking/shared';

export const NOTICE_EVENTS = [
  'booking_pending',
  'booking_confirmed',
  'booking_rejected',
  'booking_cancelled',
  'refund_issued',
  'booking_reminder',
  'hold_expiring',
  'staff_new_pending',
  'review_request',
  'review_posted',
] as const;
export type NoticeEvent = (typeof NOTICE_EVENTS)[number];

/** Everything a template needs, stored with the notice so delivery never re-reads the booking. Times are ISO strings. */
export type NoticeData = {
  bookingId: string;
  reference: string;
  venueName: string;
  turfName: string;
  timezone: string;
  startAt: string;
  endAt: string;
  currency: string;
  /** Refund amount for refund_issued, or the amount being refunded for booking_cancelled (0 or absent: no refund line). */
  amount?: number;
  reason?: string | null;
  /** booking_rejected by the auto-reject sweep, not by staff: the template words it itself and shows no reason. */
  autoRejected?: boolean;
  customerName?: string;
  holdExpiresAt?: string;
  /** review_posted: the owner whose reviews page the notice links to. */
  ownerId?: string;
  stars?: number;
  /** At most 140 characters, cut with an ellipsis. */
  comment?: string | null;
};

type Ctx = {
  d: NoticeData;
  /** Venue, turf, local date and time range. */
  when: string;
  start: string;
  holdUntil: string;
  money: string;
  link: string;
};
type Parts = { subject: string; lead: string; extra?: string; sms: string };
type Builder = (c: Ctx) => Parts;

// Newer ICU puts a narrow no-break space before AM/PM; plain spaces read the same and survive every mail/SMS client.
const plain = (s: string) => s.replace(new RegExp('[\u202f\u00a0]', 'g'), ' ');

const BUILDERS: Record<NoticeEvent, Record<Locale, Builder>> = {
  booking_pending: {
    en: ({ d }) => ({
      subject: `Booking request received (${d.reference})`,
      lead: 'We received your booking request. The venue will confirm it shortly.',
      sms: `Request received, awaiting venue confirmation. ${d.reference}`,
    }),
    ru: ({ d }) => ({
      subject: `Заявка на бронирование получена (${d.reference})`,
      lead: 'Мы получили вашу заявку на бронирование. Площадка скоро её подтвердит.',
      sms: `Заявка получена, ждём подтверждения площадки. ${d.reference}`,
    }),
  },
  booking_confirmed: {
    en: ({ d }) => ({
      subject: `Booking confirmed (${d.reference})`,
      lead: 'Your booking is confirmed.',
      sms: `Booking confirmed. ${d.reference}`,
    }),
    ru: ({ d }) => ({
      subject: `Бронирование подтверждено (${d.reference})`,
      lead: 'Ваше бронирование подтверждено.',
      sms: `Бронирование подтверждено. ${d.reference}`,
    }),
  },
  booking_rejected: {
    en: ({ d }) =>
      d.autoRejected
        ? {
            subject: `Booking request not confirmed (${d.reference})`,
            lead: 'The venue did not confirm your request in time.',
            sms: `The venue did not confirm your request in time. ${d.reference}`,
          }
        : {
            subject: `Booking declined (${d.reference})`,
            lead: 'Sorry, the venue declined your booking request.',
            extra: d.reason ? `Reason: ${d.reason}` : undefined,
            sms: `Booking declined by the venue. ${d.reference}`,
          },
    ru: ({ d }) =>
      d.autoRejected
        ? {
            subject: `Заявка на бронирование не подтверждена (${d.reference})`,
            lead: 'Площадка не подтвердила заявку вовремя.',
            sms: `Площадка не подтвердила заявку вовремя. ${d.reference}`,
          }
        : {
            subject: `Бронирование отклонено (${d.reference})`,
            lead: 'К сожалению, площадка отклонила вашу заявку на бронирование.',
            extra: d.reason ? `Причина: ${d.reason}` : undefined,
            sms: `Площадка отклонила бронирование. ${d.reference}`,
          },
  },
  booking_cancelled: {
    en: ({ d, money }) => ({
      subject: `Booking cancelled (${d.reference})`,
      lead: 'Your booking is cancelled.',
      extra: d.amount ? `Refund: ${money}` : undefined,
      sms: `Booking cancelled. ${d.reference}`,
    }),
    ru: ({ d, money }) => ({
      subject: `Бронирование отменено (${d.reference})`,
      lead: 'Ваше бронирование отменено.',
      extra: d.amount ? `Возврат: ${money}` : undefined,
      sms: `Бронирование отменено. ${d.reference}`,
    }),
  },
  refund_issued: {
    en: ({ d, money }) => ({
      subject: `Refund issued (${d.reference})`,
      lead: `${money} has been refunded.`,
      sms: `${money} refunded. ${d.reference}`,
    }),
    ru: ({ d, money }) => ({
      subject: `Возврат средств выполнен (${d.reference})`,
      lead: `Возвращено ${money}.`,
      sms: `Возвращено ${money}. ${d.reference}`,
    }),
  },
  booking_reminder: {
    en: ({ d, start }) => ({
      subject: `Reminder: your game is coming up (${d.reference})`,
      lead: `Your game starts at ${start}.`,
      sms: `Your game starts at ${start}. ${d.reference}`,
    }),
    ru: ({ d, start }) => ({
      subject: `Напоминание: скоро ваша игра (${d.reference})`,
      lead: `Ваша игра начинается в ${start}.`,
      sms: `Игра начинается в ${start}. ${d.reference}`,
    }),
  },
  hold_expiring: {
    en: ({ d, holdUntil }) => ({
      subject: `Pay soon to keep your slot (${d.reference})`,
      lead: `Pay before ${holdUntil} or the slot is released.`,
      sms: `Pay before ${holdUntil} or the slot is released. ${d.reference}`,
    }),
    ru: ({ d, holdUntil }) => ({
      subject: `Оплатите, чтобы сохранить слот (${d.reference})`,
      lead: `Оплатите до ${holdUntil}, иначе слот будет освобождён.`,
      sms: `Оплатите до ${holdUntil}, иначе слот освободится. ${d.reference}`,
    }),
  },
  staff_new_pending: {
    en: ({ d }) => ({
      subject: `New booking request (${d.reference})`,
      lead: `New booking request from ${d.customerName ?? 'a customer'}, waiting for confirmation.`,
      sms: `New booking request from ${d.customerName ?? 'a customer'}. ${d.reference}`,
    }),
    ru: ({ d }) => ({
      subject: `Новая заявка на бронирование (${d.reference})`,
      lead: `Новая заявка на бронирование от ${d.customerName ?? 'клиента'}, ожидает подтверждения.`,
      sms: `Новая заявка от ${d.customerName ?? 'клиента'}. ${d.reference}`,
    }),
  },
  review_request: {
    en: ({ d }) => ({
      subject: `How was your game? (${d.reference})`,
      lead: `Thanks for playing at ${d.venueName}. Rate the venue to help other players choose.`,
      sms: `How was ${d.venueName}? Rate your game:`,
    }),
    ru: ({ d }) => ({
      subject: `Как прошла игра? (${d.reference})`,
      lead: `Спасибо, что играли на площадке ${d.venueName}. Оцените её — это поможет другим игрокам с выбором.`,
      sms: `Как вам ${d.venueName}? Оцените игру:`,
    }),
  },
  review_posted: {
    en: ({ d }) => ({
      subject: `New review: ${d.stars} of 5 (${d.reference})`,
      lead: `${d.customerName ?? 'A player'} rated ${d.venueName} ${d.stars} out of 5.`,
      extra: d.comment ? `"${d.comment}"` : undefined,
      sms: `New ${d.stars}/5 review for ${d.venueName}. ${d.reference}`,
    }),
    ru: ({ d }) => ({
      subject: `Новый отзыв: ${d.stars} из 5 (${d.reference})`,
      lead: `Новая оценка площадки ${d.venueName}: ${d.stars} из 5 от ${d.customerName ?? 'игрока'}.`,
      extra: d.comment ? `«${d.comment}»` : undefined,
      sms: `Новый отзыв ${d.stars}/5 о площадке ${d.venueName}. ${d.reference}`,
    }),
  },
};

const LABELS: Record<Locale, { reference: string; link: string }> = {
  en: { reference: 'Reference', link: 'Details' },
  ru: { reference: 'Номер', link: 'Подробности' },
};

/** Renders one event for the recipient's locale. Pure: no DB, no clock, so it is safe to call at delivery time. */
export function renderNotice(event: NoticeEvent, locale: Locale, d: NoticeData, appUrl: string) {
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: d.timezone, ...opts });
  const dateTime = (iso: string) => plain(fmt({ dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)));
  const time = (iso: string) => plain(fmt({ timeStyle: 'short' }).format(new Date(iso)));

  const link =
    event === 'staff_new_pending'
      ? `${appUrl}/dashboard/bookings/${d.bookingId}`
      : event === 'review_request'
        ? `${appUrl}/me/bookings/${d.bookingId}?review=1`
        : event === 'review_posted'
          ? `${appUrl}/owner/${d.ownerId}/reviews`
          : `${appUrl}/b/${d.reference}`;
  const ctx: Ctx = {
    d,
    when: `${d.venueName}, ${d.turfName}\n${dateTime(d.startAt)} - ${time(d.endAt)}`,
    start: time(d.startAt),
    holdUntil: d.holdExpiresAt ? time(d.holdExpiresAt) : '',
    money: d.amount ? formatMoney(d.amount, d.currency, locale) : '',
    link,
  };
  const p = BUILDERS[event][locale](ctx);
  const labels = LABELS[locale];
  const text = [p.lead, p.extra, ctx.when, `${labels.reference}: ${d.reference}`, `${labels.link}: ${link}`].filter(Boolean).join('\n\n');
  return { subject: p.subject, text, sms: `${p.sms} ${link}` };
}
