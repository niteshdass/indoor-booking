import type { TFunction } from 'i18next';
import { currencyExponent, formatMoney, WEEKDAYS } from '@booking/shared';
import type { OwnerTurf, WeeklyHours } from '../types';

/** "Every day 06:00–00:00", "Closed all week" or "Differs by day". */
export function hoursSummary(hours: WeeklyHours, t: TFunction): string {
  const days = WEEKDAYS.map((d) => hours[d]);
  const firstDay = days[0]!;
  const same = days.every((d) => JSON.stringify(d) === JSON.stringify(firstDay));
  if (!same) return t('mobile.owner.venues.variesByDay');
  if (firstDay === 'closed') return t('mobile.owner.venues.closedAllWeek');
  return t('mobile.owner.venues.everyDay', { hours: `${firstDay.open}–${firstDay.close}` });
}

/** "Futsal, Cricket · Indoor · ৳900 / 30 min" for a court row. */
export function turfSummary(turf: OwnerTurf, currency: string, t: TFunction, lang: string): string {
  const price = turf.pricing
    ? t('mobile.owner.venues.perSlot', { price: formatMoney(turf.pricing.base, currency, lang), minutes: turf.slotLengthMin })
    : t('mobile.owner.venues.noPrice');
  return [turf.sports.map((s) => t(`sports.${s}`)).join(', '), t(turf.indoor ? 'venue.indoor' : 'venue.outdoor'), price].join(' · ');
}

/** Minor units as an editable string ("900", "12.5"): no grouping, trailing zeros dropped, so parseMoney reads it back. */
export function minorToInput(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  const digits = String(minor).padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}
