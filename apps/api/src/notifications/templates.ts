import { formatMoney, type Locale, type SeriesClashReason } from '@booking/shared';

export const NOTICE_EVENTS = [
  'booking_pending',
  'booking_confirmed',
  'booking_rejected',
  'payment_received',
  'payment_not_found',
  'booking_cancelled',
  'booking_rescheduled',
  'refund_issued',
  'booking_reminder',
  'hold_expiring',
  'staff_new_pending',
  'staff_booking_rescheduled',
  'staff_refund_external',
  'staff_dispute_opened',
  'staff_dispute_closed',
  'review_request',
  'review_posted',
  'series_requested',
  'series_accepted',
  'series_declined',
  'series_created',
  'series_games_cancelled',
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
  seriesId?: string;
  /** Series events: ISO starts, ascending, at most 30 listed; `moreGames` counts the rest. */
  games?: string[];
  moreGames?: number;
  skipped?: { date: string; reason: SeriesClashReason }[];
  /** Games that stay booked (ISO starts). */
  kept?: string[];
  /** series_games_cancelled: the notice goes to staff, so it links to the series page. */
  toStaff?: boolean;
  /** Reschedule events: where the booking was before the move. */
  previousTurfName?: string;
  previousStartAt?: string;
  previousEndAt?: string;
};

type Ctx = {
  d: NoticeData;
  /** Venue, turf, local date and time range. */
  when: string;
  start: string;
  /** Local date and start time. */
  startsAt: string;
  /** Reschedule events: the old turf, local date and time range; empty otherwise. */
  was: string;
  holdUntil: string;
  money: string;
  link: string;
  /** Series events: the games, one per line, with a "+N more" tail. */
  gameLines: string;
  /** Number of games in the series notice, listed or not. */
  gameCount: number;
  /** Local date and time of the first listed game. */
  firstGame: string;
  /** Skipped and kept dates, translated; empty when there are none. */
  skippedKept: string;
};
type Parts = { subject: string; lead: string; extra?: string; sms: string };
type Builder = (c: Ctx) => Parts;

// Newer ICU puts a narrow no-break space before AM/PM; plain spaces read the same and survive every mail/SMS client.
const plain = (s: string) => s.replace(new RegExp('[\u202f\u00a0]', 'g'), ' ');

const ruGames = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'игра' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'игры' : 'игр';
  return `${n} ${word}`;
};
/** «забронирована/ы/о» agreeing with the count, as «игра/игры/игр» does. */
const ruBooked = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? 'забронирована' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'забронированы' : 'забронировано';
};
const enGames = (n: number) => `${n} ${n === 1 ? 'game' : 'games'}`;
/** Counts in Bangla digits, matching the dates Intl writes for `bn`. */
const bnNum = (n: number) => new Intl.NumberFormat('bn').format(n);
const bnGames = (n: number) => `${bnNum(n)}টি খেলা`;

const CLASH_LABELS: Record<Locale, Record<SeriesClashReason, string>> = {
  en: {
    closed: 'the venue is closed',
    past: 'already in the past',
    taken: 'already booked',
    blocked: 'the turf is blocked',
    outside_hours: 'outside opening hours',
  },
  ru: {
    closed: 'площадка закрыта',
    past: 'время уже прошло',
    taken: 'уже занято',
    blocked: 'поле недоступно',
    outside_hours: 'вне часов работы',
  },
  bn: {
    closed: 'ভেন্যু বন্ধ',
    past: 'সময় পেরিয়ে গেছে',
    taken: 'আগেই বুক করা',
    blocked: 'মাঠ বন্ধ রাখা',
    outside_hours: 'খোলার সময়ের বাইরে',
  },
};

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
    bn: ({ d }) => ({
      subject: `বুকিং অনুরোধ পাওয়া গেছে (${d.reference})`,
      lead: 'আমরা আপনার বুকিং অনুরোধ পেয়েছি। ভেন্যু শিগগিরই এটি নিশ্চিত করবে।',
      sms: `অনুরোধ পাওয়া গেছে, ভেন্যুর নিশ্চিতকরণের অপেক্ষায়। ${d.reference}`,
    }),
  },
  booking_confirmed: {
    en: ({ d, startsAt }) => ({
      subject: `Booking confirmed (${d.reference})`,
      lead: 'Your booking is confirmed.',
      sms: `Booking confirmed: ${d.venueName}, ${d.turfName}, ${startsAt}. ${d.reference}`,
    }),
    ru: ({ d, startsAt }) => ({
      subject: `Бронирование подтверждено (${d.reference})`,
      lead: 'Ваше бронирование подтверждено.',
      sms: `Бронирование подтверждено: ${d.venueName}, ${d.turfName}, ${startsAt}. ${d.reference}`,
    }),
    bn: ({ d, startsAt }) => ({
      subject: `বুকিং নিশ্চিত (${d.reference})`,
      lead: 'আপনার বুকিং নিশ্চিত হয়েছে।',
      sms: `বুকিং নিশ্চিত: ${d.venueName}, ${d.turfName}, ${startsAt}। ${d.reference}`,
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
    bn: ({ d }) =>
      d.autoRejected
        ? {
            subject: `বুকিং অনুরোধ নিশ্চিত হয়নি (${d.reference})`,
            lead: 'ভেন্যু সময়মতো আপনার অনুরোধ নিশ্চিত করেনি।',
            sms: `ভেন্যু সময়মতো আপনার অনুরোধ নিশ্চিত করেনি। ${d.reference}`,
          }
        : {
            subject: `বুকিং প্রত্যাখ্যাত (${d.reference})`,
            lead: 'দুঃখিত, ভেন্যু আপনার বুকিং অনুরোধ প্রত্যাখ্যান করেছে।',
            extra: d.reason ? `কারণ: ${d.reason}` : undefined,
            sms: `ভেন্যু বুকিং প্রত্যাখ্যান করেছে। ${d.reference}`,
          },
  },
  payment_received: {
    en: ({ d, startsAt }) => ({
      subject: `Payment received — your booking ${d.reference} is confirmed`,
      lead: 'The venue received your payment. Your booking is confirmed.',
      sms: `Payment received, booking confirmed: ${d.venueName}, ${d.turfName}, ${startsAt}. ${d.reference}`,
    }),
    ru: ({ d, startsAt }) => ({
      subject: `Оплата получена — ваше бронирование ${d.reference} подтверждено`,
      lead: 'Площадка получила вашу оплату. Ваше бронирование подтверждено.',
      sms: `Оплата получена, бронирование подтверждено: ${d.venueName}, ${d.turfName}, ${startsAt}. ${d.reference}`,
    }),
    bn: ({ d, startsAt }) => ({
      subject: `পেমেন্ট পাওয়া গেছে — আপনার বুকিং ${d.reference} নিশ্চিত`,
      lead: 'ভেন্যু আপনার পেমেন্ট পেয়েছে। আপনার বুকিং নিশ্চিত।',
      sms: `পেমেন্ট পাওয়া গেছে, বুকিং নিশ্চিত: ${d.venueName}, ${d.turfName}, ${startsAt}। ${d.reference}`,
    }),
  },
  payment_not_found: {
    en: ({ d }) => ({
      subject: `We couldn't find your payment for ${d.reference}`,
      lead: "The venue couldn't find your payment, so your booking request was declined. If you paid, contact the venue.",
      sms: `Payment not found, booking declined. ${d.reference}`,
    }),
    ru: ({ d }) => ({
      subject: `Мы не нашли ваш платёж за бронирование ${d.reference}`,
      lead: 'Площадка не нашла ваш платёж, поэтому заявка на бронирование отклонена. Если оплата была, свяжитесь с площадкой.',
      sms: `Платёж не найден, бронирование отклонено. ${d.reference}`,
    }),
    bn: ({ d }) => ({
      subject: `${d.reference}-এর পেমেন্ট খুঁজে পাওয়া যায়নি`,
      lead: 'ভেন্যু আপনার পেমেন্ট খুঁজে পায়নি, তাই বুকিং অনুরোধ প্রত্যাখ্যাত হয়েছে। পেমেন্ট করে থাকলে ভেন্যুর সাথে যোগাযোগ করুন।',
      sms: `পেমেন্ট পাওয়া যায়নি, বুকিং প্রত্যাখ্যাত। ${d.reference}`,
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
    bn: ({ d, money }) => ({
      subject: `বুকিং বাতিল (${d.reference})`,
      lead: 'আপনার বুকিং বাতিল হয়েছে।',
      extra: d.amount ? `রিফান্ড: ${money}` : undefined,
      sms: `বুকিং বাতিল। ${d.reference}`,
    }),
  },
  booking_rescheduled: {
    en: ({ d, startsAt, was }) => ({
      subject: `Booking moved (${d.reference})`,
      lead: 'Your booking has been moved to a new time.',
      extra: was ? `Was: ${was}` : undefined,
      sms: `Booking moved: ${d.venueName}, ${d.turfName}, ${startsAt}. ${d.reference}`,
    }),
    ru: ({ d, startsAt, was }) => ({
      subject: `Бронирование перенесено (${d.reference})`,
      lead: 'Ваше бронирование перенесено на новое время.',
      extra: was ? `Было: ${was}` : undefined,
      sms: `Бронирование перенесено: ${d.venueName}, ${d.turfName}, ${startsAt}. ${d.reference}`,
    }),
    bn: ({ d, startsAt, was }) => ({
      subject: `বুকিং সরানো হয়েছে (${d.reference})`,
      lead: 'আপনার বুকিং নতুন সময়ে সরানো হয়েছে।',
      extra: was ? `আগে ছিল: ${was}` : undefined,
      sms: `বুকিং সরানো হয়েছে: ${d.venueName}, ${d.turfName}, ${startsAt}। ${d.reference}`,
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
    bn: ({ d, money }) => ({
      subject: `রিফান্ড দেওয়া হয়েছে (${d.reference})`,
      lead: `${money} রিফান্ড করা হয়েছে।`,
      sms: `${money} রিফান্ড হয়েছে। ${d.reference}`,
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
    bn: ({ d, start }) => ({
      subject: `মনে করিয়ে দিচ্ছি: আপনার খেলা শিগগিরই (${d.reference})`,
      lead: `আপনার খেলা শুরু ${start}-এ।`,
      sms: `আপনার খেলা শুরু ${start}-এ। ${d.reference}`,
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
    bn: ({ d, holdUntil }) => ({
      subject: `স্লট ধরে রাখতে দ্রুত পেমেন্ট করুন (${d.reference})`,
      lead: `${holdUntil}-এর আগে পেমেন্ট করুন, নইলে স্লট ছেড়ে দেওয়া হবে।`,
      sms: `${holdUntil}-এর আগে পেমেন্ট করুন, নইলে স্লট ছেড়ে দেওয়া হবে। ${d.reference}`,
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
    bn: ({ d }) => ({
      subject: `নতুন বুকিং অনুরোধ (${d.reference})`,
      lead: `${d.customerName ?? 'একজন কাস্টমার'}-এর নতুন বুকিং অনুরোধ, নিশ্চিতকরণের অপেক্ষায়।`,
      sms: `${d.customerName ?? 'একজন কাস্টমার'}-এর নতুন বুকিং অনুরোধ। ${d.reference}`,
    }),
  },
  staff_booking_rescheduled: {
    en: ({ d, startsAt, was }) => ({
      subject: `Booking moved by the customer (${d.reference})`,
      lead: `${d.customerName ?? 'A customer'} moved their booking to a new time.`,
      extra: was ? `Was: ${was}` : undefined,
      sms: `${d.customerName ?? 'A customer'} moved a booking to ${startsAt}. ${d.reference}`,
    }),
    ru: ({ d, startsAt, was }) => ({
      subject: `Клиент перенёс бронирование (${d.reference})`,
      lead: `${d.customerName ?? 'Клиент'} перенёс бронирование на новое время.`,
      extra: was ? `Было: ${was}` : undefined,
      sms: `${d.customerName ?? 'Клиент'} перенёс бронирование на ${startsAt}. ${d.reference}`,
    }),
    bn: ({ d, startsAt, was }) => ({
      subject: `কাস্টমার বুকিং সরিয়েছেন (${d.reference})`,
      lead: `${d.customerName ?? 'একজন কাস্টমার'} তাঁর বুকিং নতুন সময়ে সরিয়েছেন।`,
      extra: was ? `আগে ছিল: ${was}` : undefined,
      sms: `${d.customerName ?? 'একজন কাস্টমার'} বুকিং ${startsAt}-এ সরিয়েছেন। ${d.reference}`,
    }),
  },
  staff_refund_external: {
    en: ({ d, money }) => ({
      subject: `Refund made in Stripe (${d.reference})`,
      lead: `A refund of ${money} to ${d.customerName ?? 'the customer'} was made in the Stripe dashboard. It is now recorded on the booking.`,
      sms: `Refund of ${money} made in Stripe is recorded. ${d.reference}`,
    }),
    ru: ({ d, money }) => ({
      subject: `Возврат через Stripe (${d.reference})`,
      lead: `Возврат ${money} для ${d.customerName ?? 'клиента'} сделан в панели Stripe. Он записан в бронирование.`,
      sms: `Возврат ${money} через Stripe записан. ${d.reference}`,
    }),
    bn: ({ d, money }) => ({
      subject: `Stripe-এ রিফান্ড করা হয়েছে (${d.reference})`,
      lead: `${d.customerName ?? 'কাস্টমার'}-কে ${money} রিফান্ড Stripe ড্যাশবোর্ডে করা হয়েছে। এটি এখন বুকিংয়ে লেখা আছে।`,
      sms: `Stripe-এ করা ${money} রিফান্ড লেখা হয়েছে। ${d.reference}`,
    }),
  },
  staff_dispute_opened: {
    en: ({ d, money }) => ({
      subject: `Card payment disputed (${d.reference})`,
      lead: `${d.customerName ?? 'The customer'} disputed a card payment of ${money}. Respond in the Stripe dashboard before its deadline.`,
      sms: `Card payment of ${money} disputed. Respond in Stripe. ${d.reference}`,
    }),
    ru: ({ d, money }) => ({
      subject: `Платёж картой оспорен (${d.reference})`,
      lead: `Платёж картой на ${money} оспорен (клиент: ${d.customerName ?? 'не указан'}). Ответьте в панели Stripe до указанного срока.`,
      sms: `Платёж ${money} оспорен. Ответьте в Stripe. ${d.reference}`,
    }),
    bn: ({ d, money }) => ({
      subject: `কার্ড পেমেন্টে আপত্তি (${d.reference})`,
      lead: `${d.customerName ?? 'কাস্টমার'} ${money}-এর কার্ড পেমেন্টে আপত্তি করেছেন। সময়সীমার আগে Stripe ড্যাশবোর্ডে উত্তর দিন।`,
      sms: `${money}-এর কার্ড পেমেন্টে আপত্তি। Stripe-এ উত্তর দিন। ${d.reference}`,
    }),
  },
  staff_dispute_closed: {
    en: ({ d, money }) => ({
      subject: `${d.reason === 'lost' ? 'Dispute lost' : 'Dispute won'} (${d.reference})`,
      lead:
        d.reason === 'lost'
          ? `The dispute over ${money} closed in the customer's favour: the money went back to them.`
          : `The dispute over ${money} closed in your favour: the money stays with you.`,
      sms: `${d.reason === 'lost' ? 'Dispute lost' : 'Dispute won'}: ${money}. ${d.reference}`,
    }),
    ru: ({ d, money }) => ({
      subject: `${d.reason === 'lost' ? 'Спор проигран' : 'Спор выигран'} (${d.reference})`,
      lead:
        d.reason === 'lost'
          ? `Спор по платежу ${money} решён в пользу клиента: деньги возвращены клиенту.`
          : `Спор по платежу ${money} решён в вашу пользу: деньги остаются у вас.`,
      sms: `${d.reason === 'lost' ? 'Спор проигран' : 'Спор выигран'}: ${money}. ${d.reference}`,
    }),
    bn: ({ d, money }) => ({
      subject: `${d.reason === 'lost' ? 'আপত্তিতে হার' : 'আপত্তিতে জয়'} (${d.reference})`,
      lead:
        d.reason === 'lost'
          ? `${money}-এর আপত্তি কাস্টমারের পক্ষে নিষ্পত্তি হয়েছে: টাকা তাঁকে ফেরত গেছে।`
          : `${money}-এর আপত্তি আপনার পক্ষে নিষ্পত্তি হয়েছে: টাকা আপনার কাছেই থাকছে।`,
      sms: `${d.reason === 'lost' ? 'আপত্তিতে হার' : 'আপত্তিতে জয়'}: ${money}। ${d.reference}`,
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
    bn: ({ d }) => ({
      subject: `খেলা কেমন হলো? (${d.reference})`,
      lead: `${d.venueName}-এ খেলার জন্য ধন্যবাদ। ভেন্যুকে রেটিং দিন, অন্য খেলোয়াড়দের বাছাইয়ে সাহায্য হবে।`,
      sms: `${d.venueName} কেমন লাগল? রেটিং দিন:`,
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
    bn: ({ d }) => ({
      subject: `নতুন রিভিউ: ৫-এ ${bnNum(d.stars ?? 0)} (${d.reference})`,
      lead: `${d.customerName ?? 'একজন খেলোয়াড়'} ${d.venueName}-কে ৫-এ ${bnNum(d.stars ?? 0)} দিয়েছেন।`,
      extra: d.comment ? `“${d.comment}”` : undefined,
      sms: `${d.venueName}-এর নতুন রিভিউ ${bnNum(d.stars ?? 0)}/৫। ${d.reference}`,
    }),
  },
  series_requested: {
    en: ({ d, gameCount, firstGame }) => ({
      subject: `New recurring booking request (${d.reference})`,
      lead: `${d.customerName ?? 'A customer'} asked to book ${enGames(gameCount)} on a repeating schedule. Please accept or decline.`,
      sms: `Recurring request from ${d.customerName ?? 'a customer'}: ${enGames(gameCount)}, from ${firstGame}. ${d.reference}`,
    }),
    ru: ({ d, gameCount, firstGame }) => ({
      subject: `Новая заявка на регулярное бронирование (${d.reference})`,
      lead: `${d.customerName ?? 'Клиент'} просит забронировать поле на регулярной основе: ${ruGames(gameCount)}. Примите или отклоните заявку.`,
      sms: `Заявка на регулярные игры от ${d.customerName ?? 'клиента'}: ${ruGames(gameCount)}, с ${firstGame}. ${d.reference}`,
    }),
    bn: ({ d, gameCount, firstGame }) => ({
      subject: `নতুন নিয়মিত বুকিং অনুরোধ (${d.reference})`,
      lead: `${d.customerName ?? 'একজন কাস্টমার'} নিয়মিত সময়সূচিতে ${bnGames(gameCount)} বুক করতে চান। গ্রহণ বা প্রত্যাখ্যান করুন।`,
      sms: `${d.customerName ?? 'একজন কাস্টমার'}-এর নিয়মিত অনুরোধ: ${bnGames(gameCount)}, ${firstGame} থেকে। ${d.reference}`,
    }),
  },
  series_accepted: {
    en: ({ d, gameCount, firstGame }) => ({
      subject: 'Your recurring booking is confirmed',
      lead: `The venue accepted your recurring booking: ${enGames(gameCount)} ${gameCount === 1 ? 'is' : 'are'} booked.`,
      sms: `Recurring booking confirmed: ${enGames(gameCount)}, from ${firstGame}. ${d.reference}`,
    }),
    ru: ({ d, gameCount, firstGame }) => ({
      subject: 'Ваше регулярное бронирование подтверждено',
      lead: `Площадка приняла ваше регулярное бронирование: ${ruGames(gameCount)} ${ruBooked(gameCount)}.`,
      sms: `Регулярное бронирование подтверждено: ${ruGames(gameCount)}, с ${firstGame}. ${d.reference}`,
    }),
    bn: ({ d, gameCount, firstGame }) => ({
      subject: 'আপনার নিয়মিত বুকিং নিশ্চিত',
      lead: `ভেন্যু আপনার নিয়মিত বুকিং গ্রহণ করেছে: ${bnGames(gameCount)} বুক করা হয়েছে।`,
      sms: `নিয়মিত বুকিং নিশ্চিত: ${bnGames(gameCount)}, ${firstGame} থেকে। ${d.reference}`,
    }),
  },
  series_declined: {
    en: ({ d }) =>
      d.autoRejected
        ? {
            subject: 'Your recurring booking request expired',
            lead: 'Your recurring booking request was not answered in time, so it has been closed.',
            sms: `Your recurring booking request expired without an answer. ${d.reference}`,
          }
        : {
            subject: 'Your recurring booking was declined',
            lead: 'Sorry, the venue declined your recurring booking request.',
            extra: d.reason ? `Reason: ${d.reason}` : undefined,
            sms: `The venue declined your recurring booking request. ${d.reference}`,
          },
    ru: ({ d }) =>
      d.autoRejected
        ? {
            subject: 'Заявка на регулярное бронирование истекла',
            lead: 'На вашу заявку на регулярное бронирование не ответили вовремя, поэтому она закрыта.',
            sms: `Заявка на регулярное бронирование истекла без ответа. ${d.reference}`,
          }
        : {
            subject: 'Ваше регулярное бронирование отклонено',
            lead: 'К сожалению, площадка отклонила вашу заявку на регулярное бронирование.',
            extra: d.reason ? `Причина: ${d.reason}` : undefined,
            sms: `Площадка отклонила заявку на регулярное бронирование. ${d.reference}`,
          },
    bn: ({ d }) =>
      d.autoRejected
        ? {
            subject: 'আপনার নিয়মিত বুকিং অনুরোধের মেয়াদ শেষ',
            lead: 'আপনার নিয়মিত বুকিং অনুরোধের সময়মতো উত্তর আসেনি, তাই এটি বন্ধ করা হয়েছে।',
            sms: `উত্তর ছাড়াই আপনার নিয়মিত বুকিং অনুরোধের মেয়াদ শেষ। ${d.reference}`,
          }
        : {
            subject: 'আপনার নিয়মিত বুকিং প্রত্যাখ্যাত',
            lead: 'দুঃখিত, ভেন্যু আপনার নিয়মিত বুকিং অনুরোধ প্রত্যাখ্যান করেছে।',
            extra: d.reason ? `কারণ: ${d.reason}` : undefined,
            sms: `ভেন্যু আপনার নিয়মিত বুকিং অনুরোধ প্রত্যাখ্যান করেছে। ${d.reference}`,
          },
  },
  series_created: {
    en: ({ d, gameCount, firstGame }) => ({
      subject: 'Your recurring booking is set up',
      lead: `${enGames(gameCount)} ${gameCount === 1 ? 'is' : 'are'} booked for you.`,
      sms: `Recurring booking set up: ${enGames(gameCount)}, from ${firstGame}. ${d.reference}`,
    }),
    ru: ({ d, gameCount, firstGame }) => ({
      subject: 'Регулярное бронирование оформлено',
      lead: `${ruGames(gameCount)} ${ruBooked(gameCount)} для вас.`,
      sms: `Регулярное бронирование оформлено: ${ruGames(gameCount)}, с ${firstGame}. ${d.reference}`,
    }),
    bn: ({ d, gameCount, firstGame }) => ({
      subject: 'আপনার নিয়মিত বুকিং তৈরি হয়েছে',
      lead: `আপনার জন্য ${bnGames(gameCount)} বুক করা হয়েছে।`,
      sms: `নিয়মিত বুকিং তৈরি: ${bnGames(gameCount)}, ${firstGame} থেকে। ${d.reference}`,
    }),
  },
  series_games_cancelled: {
    en: ({ d, gameCount, firstGame }) => ({
      subject: `${gameCount === 1 ? 'A recurring game was' : 'Recurring games were'} cancelled`,
      lead: d.toStaff
        ? `${d.customerName ?? 'A player'} cancelled ${enGames(gameCount)} of a recurring booking.`
        : `${enGames(gameCount)} of your recurring booking ${gameCount === 1 ? 'was' : 'were'} cancelled.`,
      extra: d.reason ? `Reason: ${d.reason}` : undefined,
      sms: `Cancelled: ${enGames(gameCount)}, ${firstGame}. ${d.reference}`,
    }),
    ru: ({ d, gameCount, firstGame }) => ({
      subject: gameCount === 1 ? 'Игра из регулярного бронирования отменена' : 'Игры из регулярного бронирования отменены',
      lead: d.toStaff
        ? `${d.customerName ?? 'Игрок'}: отмена в регулярном бронировании, ${ruGames(gameCount)}.`
        : `Отменено в вашем регулярном бронировании: ${ruGames(gameCount)}.`,
      extra: d.reason ? `Причина: ${d.reason}` : undefined,
      sms: `Отменено: ${ruGames(gameCount)}, ${firstGame}. ${d.reference}`,
    }),
    bn: ({ d, gameCount, firstGame }) => ({
      subject: 'নিয়মিত বুকিংয়ের খেলা বাতিল',
      lead: d.toStaff
        ? `${d.customerName ?? 'একজন খেলোয়াড়'} নিয়মিত বুকিংয়ের ${bnGames(gameCount)} বাতিল করেছেন।`
        : `আপনার নিয়মিত বুকিংয়ের ${bnGames(gameCount)} বাতিল হয়েছে।`,
      extra: d.reason ? `কারণ: ${d.reason}` : undefined,
      sms: `বাতিল: ${bnGames(gameCount)}, ${firstGame}। ${d.reference}`,
    }),
  },
};

const SERIES_EVENTS: readonly NoticeEvent[] = NOTICE_EVENTS.filter((e) => e.startsWith('series_'));
/** Money staff should know about that moved outside the app: they go to members who can issue refunds. */
export const STAFF_PAYMENT_EVENTS: readonly NoticeEvent[] = ['staff_refund_external', 'staff_dispute_opened', 'staff_dispute_closed'];

const LABELS: Record<Locale, { reference: string; link: string; more: (n: number) => string; skipped: string; kept: string }> = {
  en: { reference: 'Reference', link: 'Details', more: (n) => `+${n} more`, skipped: 'Skipped', kept: 'Still booked' },
  ru: { reference: 'Номер', link: 'Подробности', more: (n) => `ещё ${n}`, skipped: 'Пропущено', kept: 'Остаются в силе' },
  bn: { reference: 'রেফারেন্স', link: 'বিস্তারিত', more: (n) => `আরও ${bnNum(n)}টি`, skipped: 'বাদ পড়েছে', kept: 'এখনও বুক করা' },
};

/** Renders one event for the recipient's locale. Pure: no DB, no clock, so it is safe to call at delivery time. */
export function renderNotice(event: NoticeEvent, locale: Locale, d: NoticeData, appUrl: string) {
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: d.timezone, ...opts });
  const dateTime = (iso: string) => plain(fmt({ dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)));
  const time = (iso: string) => plain(fmt({ timeStyle: 'short' }).format(new Date(iso)));

  const isSeries = SERIES_EVENTS.includes(event);
  const labels = LABELS[locale];
  const day = (date: string) => plain(new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(`${date}T00:00:00Z`)));
  const games = d.games ?? [];
  const gameLines = [...games.map(dateTime), ...(d.moreGames ? [labels.more(d.moreGames)] : [])].join('\n');
  const skippedKept = [
    d.skipped?.length ? `${labels.skipped}:\n${d.skipped.map((s) => `${day(s.date)} - ${CLASH_LABELS[locale][s.reason]}`).join('\n')}` : '',
    d.kept?.length ? `${labels.kept}:\n${d.kept.map(dateTime).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const staffSeries = event === 'series_requested' || (event === 'series_games_cancelled' && d.toStaff);

  const link = isSeries
    ? staffSeries
      ? `${appUrl}/owner/${d.ownerId}/series/${d.seriesId}`
      : `${appUrl}/me/bookings`
    : event === 'staff_new_pending' || event === 'staff_booking_rescheduled'
      ? `${appUrl}/dashboard/bookings/${d.bookingId}`
      : event === 'review_request'
        ? `${appUrl}/me/bookings/${d.bookingId}?review=1`
        : event === 'review_posted'
          ? `${appUrl}/owner/${d.ownerId}/reviews`
          : STAFF_PAYMENT_EVENTS.includes(event)
            ? `${appUrl}/owner/${d.ownerId}/bookings/${d.bookingId}`
            : `${appUrl}/b/${d.reference}`;
  const ctx: Ctx = {
    d,
    when: `${d.venueName}, ${d.turfName}\n${dateTime(d.startAt)} - ${time(d.endAt)}`,
    start: time(d.startAt),
    startsAt: dateTime(d.startAt),
    was: d.previousStartAt && d.previousEndAt ? `${d.previousTurfName ?? d.turfName}, ${dateTime(d.previousStartAt)} - ${time(d.previousEndAt)}` : '',
    holdUntil: d.holdExpiresAt ? time(d.holdExpiresAt) : '',
    money: d.amount ? formatMoney(d.amount, d.currency, locale) : '',
    link,
    gameLines,
    gameCount: games.length + (d.moreGames ?? 0) || 1,
    firstGame: games[0] ? dateTime(games[0]) : dateTime(d.startAt),
    skippedKept,
  };
  const p = BUILDERS[event][locale](ctx);
  const where = isSeries ? `${d.venueName}, ${d.turfName}` : ctx.when;
  const text = [p.lead, p.extra, where, isSeries ? gameLines : '', isSeries ? skippedKept : '', `${labels.reference}: ${d.reference}`, `${labels.link}: ${link}`].filter(Boolean).join('\n\n');
  return { subject: p.subject, text, sms: `${p.sms} ${link}` };
}
