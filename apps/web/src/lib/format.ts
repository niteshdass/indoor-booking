import { currencyExponent, formatMoney } from '@booking/shared';

export function money(minor: number, currency: string, lang: string): string {
  return formatMoney(minor, currency, lang);
}

/** Like `money`, but a whole amount drops its zero fraction (BDT 2,000), for tight spaces such as slot cells. */
export function moneyShort(minor: number, currency: string, lang: string): string {
  const unit = 10 ** currencyExponent(currency);
  if (minor % unit !== 0) return money(minor, currency, lang);
  return new Intl.NumberFormat(lang, { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / unit);
}

/** Wall-clock time of an instant in the venue's zone, 24-hour. */
export function formatTime(iso: string, timeZone: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
}

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Short weekday, day and month. A bare YYYY-MM-DD is that calendar date in any zone; an instant is read in `timeZone`. */
export function formatDate(isoOrDate: string, timeZone: string, lang: string): string {
  const bare = BARE_DATE.test(isoOrDate);
  return new Intl.DateTimeFormat(lang, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: bare ? 'UTC' : timeZone,
  }).format(new Date(bare ? `${isoOrDate}T00:00:00Z` : isoOrDate));
}

export function formatDistance(meters: number, lang: string): string {
  if (meters < 1000) {
    return new Intl.NumberFormat(lang, { style: 'unit', unit: 'meter', unitDisplay: 'short', maximumFractionDigits: 0 }).format(meters);
  }
  return new Intl.NumberFormat(lang, { style: 'unit', unit: 'kilometer', unitDisplay: 'short', maximumFractionDigits: 1 }).format(meters / 1000);
}
