import type { TFunction } from 'i18next';
import { formatMoney, type SeriesJson } from '@booking/shared';
import { awaitsVerification, dateTime, endOf, hm, SOON_MS, startOf, type Action } from '../booking/model';
import { refundsWaiting, type RefundsPage } from '../refunds/api';
import type { OwnerBooking, OwnerVenue } from '../types';

/** One "Needs you" row. With a booking and a primary action it acts inline; otherwise it opens `href` (an app path). */
export type AttentionItem = {
  key: string;
  title: string;
  detail: string;
  tone: 'warning' | 'danger' | 'info';
  booking?: OwnerBooking;
  primary?: Action;
  /** App path under the owner, for rows without a booking action (series requests, refunds to send). */
  href?: string;
};

/** A confirmed game this long past its start without a check-in needs chasing. */
const LATE_MS = 15 * 60_000;
/** A game this close to starting makes an unchecked payment urgent. */
const VERIFY_URGENT_MS = 60 * 60_000;

/**
 * Port of apps/web/src/owner/today/Attention.tsx without the low-review rows: wallet payments to check, bookings
 * waiting for confirmation, wallet refunds to send, games starting soon that still owe, started games nobody checked in,
 * weekly requests and unpaid holds.
 */
export function buildAttention({
  venue,
  bookings,
  toVerifyAll,
  requests,
  refunds = null,
  tr,
  lang,
  now = Date.now(),
}: {
  venue: OwnerVenue;
  bookings: OwnerBooking[];
  toVerifyAll: { total: number; first: OwnerBooking | null } | null;
  requests: SeriesJson[] | null;
  /** First page of wallet refunds to send; null when not loaded or not allowed. */
  refunds?: RefundsPage | null;
  tr: TFunction;
  lang: string;
  now?: number;
}): AttentionItem[] {
  const tz = venue.timezone;
  const nameOf = (b: OwnerBooking) => b.customer?.name ?? b.reference;
  const time = (ms: number) => hm(new Date(ms).toISOString(), tz);
  const submittedAt = (b: OwnerBooking) => Date.parse(b.manualPayment?.submittedAt ?? b.createdAt);

  const toVerify = bookings.filter(awaitsVerification);
  const oldestVerify = toVerify.reduce<OwnerBooking | null>((o, b) => (o === null || submittedAt(b) < submittedAt(o) ? b : o), null);
  const verifyCount = Math.max(toVerify.length, toVerifyAll?.total ?? 0);
  const verifyNext = oldestVerify ?? (verifyCount > 0 ? (toVerifyAll?.first ?? null) : null);
  const pending = bookings.filter((b) => b.status === 'pending' && !awaitsVerification(b));
  const oldest = pending.reduce<OwnerBooking | null>((o, b) => (o === null || Date.parse(b.createdAt) < Date.parse(o.createdAt) ? b : o), null);
  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  const out: AttentionItem[] = [];

  if (verifyNext) {
    out.push({
      key: `verify${verifyNext.id}`,
      title: tr('owner.today.paymentsToVerify', { count: verifyCount }),
      detail: oldestVerify
        ? tr('owner.today.verifyOldest', { name: nameOf(oldestVerify), time: time(submittedAt(oldestVerify)) })
        : tr('owner.today.verifySoonest', { name: nameOf(verifyNext), time: dateTime(new Date(startOf(verifyNext)).toISOString(), tz, lang) }),
      tone: startOf(verifyNext) <= now + VERIFY_URGENT_MS ? 'danger' : 'warning',
      booking: verifyNext,
      primary: 'verify',
    });
  }
  if (refunds && refunds.refunds.length > 0) {
    out.push({
      key: 'refunds',
      title: tr('mobile.owner.refunds.title'),
      detail: refundsWaiting(refunds, tr),
      tone: 'warning',
      href: '/refunds',
    });
  }
  if (oldest) {
    out.push({
      key: `pending${oldest.id}`,
      title: tr('owner.today.pendingCount', { count: pending.length }),
      detail: tr('owner.today.pendingOldest', { name: nameOf(oldest), time: time(startOf(oldest)) }),
      tone: 'warning',
      booking: oldest,
      primary: 'confirm',
    });
  }
  for (const b of confirmed) {
    if (b.total - b.amountPaid > 0 && startOf(b) > now && startOf(b) <= now + SOON_MS) {
      out.push({
        key: `due${b.id}`,
        title: tr('owner.today.dueSoon', { name: nameOf(b), time: time(startOf(b)), due: formatMoney(b.total - b.amountPaid, venue.currency, lang) }),
        detail: '',
        tone: 'warning',
        booking: b,
        primary: 'markCash',
      });
    }
  }
  for (const b of confirmed) {
    if (startOf(b) < now - LATE_MS && endOf(b) > now) {
      out.push({
        key: `late${b.id}`,
        title: tr('owner.today.notCheckedIn', { name: nameOf(b), time: time(startOf(b)) }),
        detail: '',
        tone: 'danger',
        booking: b,
        primary: 'checkIn',
      });
    }
  }
  for (const s of requests ?? []) {
    out.push({
      key: `s${s.id}`,
      title: tr('owner.today.seriesRequest', { name: s.player?.name ?? s.guest?.name ?? tr('owner.today.aPlayer') }),
      detail: s.respondBy ? tr('owner.today.seriesReplyBy', { time: dateTime(s.respondBy, tz, lang) }) : '',
      tone: 'info',
      href: `/series/${encodeURIComponent(s.id)}`,
    });
  }
  for (const b of bookings) {
    if (b.status === 'awaiting_payment' && b.holdExpiresAt && Date.parse(b.holdExpiresAt) > now) {
      out.push({
        key: `h${b.id}`,
        title: tr('owner.today.holdExpiring', { name: nameOf(b) }),
        detail: tr('owner.today.holdUntil', { time: hm(b.holdExpiresAt, tz) }),
        tone: 'warning',
        booking: b,
      });
    }
  }
  return out;
}
