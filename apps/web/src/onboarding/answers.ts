import {
  MAX_SETUP_TURFS,
  WEEKDAYS,
  parseMoney,
  type BusinessSetup,
  type Locale,
  type ManualWallet,
  type PricingRule,
  type Sport,
  type VenueSetup,
  type WalletProvider,
  type Weekday,
} from '@booking/shared';
import { bdMobileDigits } from '../lib/wallets';

export const STEPS = ['name', 'place', 'turfs', 'hours', 'price', 'payment', 'review'] as const;
export type Step = (typeof STEPS)[number];

/** Opening-time choices; `custom` uses `open`/`close`. All day is open = close (the API's 24h). */
export const HOURS_PRESETS = {
  early: { open: '06:00', close: '00:00' },
  day: { open: '08:00', close: '22:00' },
  allDay: { open: '00:00', close: '00:00' },
} as const;
export type HoursPreset = keyof typeof HOURS_PRESETS | 'custom';

export const SLOT_LENGTHS = [60, 90, 120] as const;

/** Everything the easy setup asks, as typed; prices stay text until they are sent. */
export type Answers = {
  name: string;
  country: string;
  /** IANA zone; empty means the country's default (defaultZoneFor), so a country change follows it. */
  timezone: string;
  currency: string;
  city: string;
  address: string;
  lat: number | null;
  lng: number | null;
  turfCount: number;
  /** Own names for turfs; an empty or missing entry keeps the numbered name. */
  turfNames: string[];
  sports: Sport[];
  indoor: boolean;
  hours: HoursPreset;
  open: string;
  close: string;
  closedDays: Weekday[];
  slotLengthMin: number;
  price: string;
  evening: boolean;
  eveningFrom: string;
  eveningPrice: string;
  wallets: Partial<Record<WalletProvider, string>>;
  publish: boolean;
};

export function defaultAnswers(country = 'BD', currency = 'BDT'): Answers {
  return {
    name: '',
    country,
    timezone: '',
    currency,
    city: '',
    address: '',
    lat: null,
    lng: null,
    turfCount: 1,
    turfNames: [],
    sports: ['football'],
    indoor: false,
    hours: 'early',
    open: '06:00',
    close: '00:00',
    closedDays: [],
    slotLengthMin: 90,
    price: '',
    evening: false,
    eveningFrom: '17:00',
    eveningPrice: '',
    wallets: {},
    publish: true,
  };
}

/** Bangladesh has its weekend on Friday and Saturday. */
export const weekendFor = (country: string): Weekday[] => (country === 'BD' ? ['fri', 'sat'] : ['sat', 'sun']);

/** Wallet numbers are asked only where those wallets exist. */
export const hasWallets = (country: string) => country === 'BD';

/** Bangla (০–৯) and Arabic-Indic digits as ASCII; spaces and thousands commas dropped. */
export function plainDigits(text: string): string {
  return text
    .replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\s,]/g, '');
}

/** A typed price in minor units, or null when it is not a positive amount of `currency`. */
export function priceMinor(text: string, currency: string): number | null {
  try {
    const minor = parseMoney(plainDigits(text), currency);
    return minor > 0 ? minor : null;
  } catch {
    return null;
  }
}

export const turfName = (a: Answers, i: number, numbered: (n: number) => string) => a.turfNames[i]?.trim() || numbered(i + 1);

export function openTimes(a: Answers): { open: string; close: string } {
  return a.hours === 'custom' ? { open: a.open, close: a.close } : HOURS_PRESETS[a.hours];
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Keys of what is missing or wrong on one step (`onboarding.err.*`); empty when the step is done. */
export function stepErrors(step: Step, a: Answers, numbered: (n: number) => string): string[] {
  const out: string[] = [];
  switch (step) {
    case 'name':
      if (!a.name.trim()) out.push('name');
      break;
    case 'place':
      if (!a.city.trim()) out.push('city');
      if (!a.address.trim()) out.push('address');
      if (a.lat === null || a.lng === null) out.push('pin');
      break;
    case 'turfs': {
      if (a.sports.length === 0) out.push('sports');
      const names = Array.from({ length: a.turfCount }, (_, i) => turfName(a, i, numbered).toLocaleLowerCase());
      if (new Set(names).size !== names.length) out.push('turfNames');
      break;
    }
    case 'hours':
      if (a.hours === 'custom' && !(TIME.test(a.open) && TIME.test(a.close))) out.push('times');
      if (a.closedDays.length === WEEKDAYS.length) out.push('allClosed');
      break;
    case 'price':
      if (priceMinor(a.price, a.currency) === null) out.push('price');
      if (a.evening) {
        if (priceMinor(a.eveningPrice, a.currency) === null) out.push('eveningPrice');
        if (!TIME.test(a.eveningFrom)) out.push('eveningFrom');
      }
      break;
    case 'payment':
      if (Object.values(a.wallets).some((n) => n && bdMobileDigits(plainDigits(n)) === null)) out.push('wallet');
      break;
    case 'review':
      break;
  }
  return out;
}

/** The first step with something missing, or null when every answer is good. */
export function firstUnfinished(a: Answers, numbered: (n: number) => string): Step | null {
  return STEPS.find((s) => stepErrors(s, a, numbered).length > 0) ?? null;
}

/** The answers as `POST /owners/:id/onboarding` takes them. Call once `firstUnfinished` is null. */
export function toVenueSetup(a: Answers, timezone: string, numbered: (n: number) => string): VenueSetup {
  const times = openTimes(a);
  const base = priceMinor(a.price, a.currency)!;
  const rules: PricingRule[] = [];
  if (a.evening) {
    // Until midnight; a weekday rule does not reach weekends, so the evening price needs both.
    const range = { start: a.eveningFrom, end: '00:00' };
    const price = priceMinor(a.eveningPrice, a.currency)!;
    rules.push({ kind: 'weekday', range, price }, { kind: 'weekend', range, price });
  }
  const manualWallets: ManualWallet[] = [];
  if (hasWallets(a.country)) {
    for (const [provider, number] of Object.entries(a.wallets) as [WalletProvider, string | undefined][]) {
      if (number?.trim()) manualWallets.push({ provider, number: `0${bdMobileDigits(plainDigits(number))}`, accountType: 'personal' });
    }
  }
  return {
    venue: {
      name: a.name.trim(),
      address: a.address.trim(),
      city: a.city.trim(),
      timezone,
      location: { lat: a.lat!, lng: a.lng! },
    },
    turfs: Array.from({ length: a.turfCount }, (_, i) => ({
      name: turfName(a, i, numbered),
      sports: a.sports,
      indoor: a.indoor,
      slotLengthMin: a.slotLengthMin,
      pricing: { base, rules },
    })),
    settings: {
      hours: Object.fromEntries(WEEKDAYS.map((d) => [d, a.closedDays.includes(d) ? 'closed' : { ...times }])) as VenueSetup['settings']['hours'],
      weekendDays: weekendFor(a.country),
      paymentMethods: { manualWallets, gateways: [] },
    },
    publish: a.publish,
  };
}

/** The answers as `POST /onboarding` takes them: the business is named after its first venue. */
export function toBusinessSetup(a: Answers, timezone: string, locale: Locale, numbered: (n: number) => string): BusinessSetup {
  return { ...toVenueSetup(a, timezone, numbered), business: { name: a.name.trim(), country: a.country, currency: a.currency, locale } };
}

export const clampTurfs = (n: number) => Math.max(1, Math.min(MAX_SETUP_TURFS, Math.round(n) || 1));
