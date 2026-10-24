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
  customerName?: string;
  holdExpiresAt?: string;
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
    en: ({ d }) => ({
      subject: `Booking declined (${d.reference})`,
      lead: 'Sorry, the venue declined your booking request.',
      extra: d.reason ? `Reason: ${d.reason}` : undefined,
      sms: `Booking declined by the venue. ${d.reference}`,
    }),
    ru: ({ d }) => ({
      subject: `Бронирование отклонено (${d.reference})`,
      lead: 'К сожалению, площадка отклонила вашу заявку на бронирование.',
      extra: d.reason ? `Причина: ${d.reason}` : undefined,
      sms: `Площадка отклонила бронирование. ${d.reference}`,
    }),
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

  const link = event === 'staff_new_pending' ? `${appUrl}/dashboard/bookings/${d.bookingId}` : `${appUrl}/b/${d.reference}`;
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
