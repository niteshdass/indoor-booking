import type { Locale } from './locales';
import type { TurfPricing } from './pricing';
import type { WeeklyHours } from './settings';
import type { Amenity, Sport, Weekday } from './venues';
import type { PaymentMethods } from './wallets';

/** Most turfs the easy setup creates in one go; more are added from the venue page. */
export const MAX_SETUP_TURFS = 20;

/**
 * What the easy setup sends: one venue with its turfs, their prices and the opening hours and payment methods.
 * `POST /onboarding` also creates the business (`business`); `POST /owners/:id/onboarding` adds a venue to one.
 */
export type VenueSetup = {
  venue: {
    name: string;
    address: string;
    city: string;
    timezone: string;
    location: { lat: number; lng: number };
    amenities?: Amenity[];
  };
  turfs: Array<{ name: string; sports: Sport[]; indoor: boolean; slotLengthMin: number; pricing: TurfPricing }>;
  settings: { hours: WeeklyHours; weekendDays: Weekday[]; paymentMethods: PaymentMethods };
  /** Show the venue to players straight away; ignored while the business waits for approval. */
  publish: boolean;
};

export type BusinessSetup = VenueSetup & {
  business: { name: string; country: string; currency: string; locale?: Locale };
};

export type SetupResult = {
  owner: { id: string; name: string; status: string };
  venue: { id: string; slug: string; published: boolean };
};
