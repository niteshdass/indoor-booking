import { WEEKDAYS, type Weekday } from './venues';

/** 'HH:MM' local venue time. close <= open means the session ends the next day; equal means 24 h. */
export type DayHours = { open: string; close: string } | 'closed';
export type WeeklyHours = Record<Weekday, DayHours>;

export type PaymentPolicy =
  | { type: 'none' }
  | { type: 'full' }
  | { type: 'partial_percent'; percent: number }
  /** Minor units of the venue's currency; venue level only. */
  | { type: 'partial_fixed'; amount: number };

export type RefundRule = { minHoursBefore: number; percent: number };
export type GuestBooking = { allowed: boolean; requireOtp: boolean };

export type OwnerSettings = {
  hours: WeeklyHours;
  weekendDays: Weekday[];
  paymentPolicy: PaymentPolicy;
  guestBooking: GuestBooking;
  /** Sorted by minHoursBefore descending; empty means no refund. */
  refundRules: RefundRule[];
  bookingWindowDays: number;
  pendingAutoRejectHours: number;
};

export type VenueSettingsOverride = Partial<Omit<OwnerSettings, 'hours' | 'pendingAutoRejectHours'>> & {
  hours?: Partial<WeeklyHours>;
};
export type TurfSettingsOverride = { hours?: Partial<WeeklyHours> };
export type EffectiveSettings = OwnerSettings;

const DEFAULT_DAY = { open: '08:00', close: '22:00' };

export const DEFAULT_OWNER_SETTINGS: OwnerSettings = {
  hours: Object.fromEntries(WEEKDAYS.map((d) => [d, { ...DEFAULT_DAY }])) as WeeklyHours,
  weekendDays: ['sat', 'sun'],
  paymentPolicy: { type: 'none' },
  guestBooking: { allowed: true, requireOtp: true },
  refundRules: [],
  bookingWindowDays: 30,
  pendingAutoRejectHours: 2,
};

const clone = <T>(v: T): T => structuredClone(v);

/** Owner settings as stored (only keys the owner set) filled with the defaults. */
export function withOwnerDefaults(stored: Partial<OwnerSettings>): OwnerSettings {
  const out = clone({ ...DEFAULT_OWNER_SETTINGS, ...stored });
  out.hours = { ...clone(DEFAULT_OWNER_SETTINGS.hours), ...clone(stored.hours ?? {}) };
  return out;
}

/**
 * Effective settings for a venue (and optionally a turf): owner, then venue, then turf.
 * Venue keys replace the owner's whole; hours merge per weekday. Any advance payment turns
 * guest booking off (spec §10).
 */
export function resolveSettings(
  owner: OwnerSettings,
  venue: VenueSettingsOverride = {},
  turf: TurfSettingsOverride = {},
): EffectiveSettings {
  const { hours: venueHours, ...venueRest } = venue;
  const out = clone({ ...owner, ...venueRest });
  out.hours = { ...clone(owner.hours), ...clone(venueHours ?? {}), ...clone(turf.hours ?? {}) } as WeeklyHours;
  if (out.paymentPolicy.type !== 'none') out.guestBooking = { ...out.guestBooking, allowed: false };
  return out;
}
