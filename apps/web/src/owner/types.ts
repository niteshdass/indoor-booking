import type {
  AddonPricingType,
  Amenity,
  AutoApplyRule,
  OverrideRule,
  OverrideWhen,
  OwnerSettings,
  Permission,
  SlotStatus,
  Sport,
  TurfPricing,
  VenueSettingsOverride,
  WalletProvider,
  WeeklyHours,
} from '@booking/shared';
import type { BookingJson, RefundJson } from '../lib/types';

export type {
  AddonPricingType,
  Amenity,
  DayHours,
  Permission,
  PaymentPolicy,
  OwnerSettings,
  RefundRule,
  Sport,
  VenueSettingsOverride,
  Weekday,
  WeeklyHours,
  PricingRule,
  TurfPricing,
} from '@booking/shared';
export type { RefundJson } from '../lib/types';

export type OwnerStatus = 'active' | 'pending_approval' | 'suspended';
export type RoleRef = { id: string; key: 'owner' | 'manager' | 'staff' | null; name: string };
export type VenueScope = 'all' | string[];

/** `GET /owners/:ownerId` membership. */
export type Membership = {
  id: string;
  role: RoleRef;
  permissions: Permission[];
  venueIds: VenueScope;
};

export type OwnerInfo = {
  id: string;
  name: string;
  country: string;
  defaultCurrency: string;
  defaultLocale: 'en' | 'ru';
  status: OwnerStatus;
};

/** One entry of `GET /me/memberships`. */
export type OwnerMembership = {
  ownerId: string;
  ownerName: string;
  ownerStatus: OwnerStatus;
  role: RoleRef;
  permissions: Permission[];
  venueIds: VenueScope;
};

export type OwnerVenue = {
  id: string;
  name: string;
  slug: string;
  address: string;
  city: string;
  country: string;
  currency: string;
  timezone: string;
  location: { lat: number; lng: number };
  photos: { url: string; alt?: string }[];
  amenities: Amenity[];
  published: boolean;
  settings: VenueSettingsOverride;
  effectiveSettings: OwnerSettings;
  createdAt: string;
};

export type OwnerTurf = {
  id: string;
  venueId: string;
  name: string;
  sports: Sport[];
  indoor: boolean;
  slotLengthMin: number;
  active: boolean;
  settings: { hours?: Partial<WeeklyHours> };
  pricing: TurfPricing | null;
  effectiveSettings: OwnerSettings;
  createdAt: string;
};

export type OwnerSlot = {
  startAt: string;
  endAt: string;
  localStart: string;
  localEnd: string;
  price: number | null;
  status: SlotStatus;
  source: 'hours' | 'modify' | 'add';
};

export type OwnerSlotDay = {
  businessDate: string;
  currency: string;
  closed: boolean;
  closedReason: string | null;
  inWindow: boolean;
  slots: OwnerSlot[];
};

export type Override = { id: string; venueId: string; turfId: string; reason: string | null } & OverrideWhen & OverrideRule;

export type Closure = { id: string; venueId: string | null; turfId: string | null; from: string; to: string; reason: string | null };

export type Addon = {
  id: string;
  name: string;
  pricingType: AddonPricingType;
  price: number;
  currency: string;
  maxQuantity: number;
  stock: number | null;
  autoApply: AutoApplyRule | null;
};

export type Assignment = {
  id: string;
  addonId: string;
  venueId: string;
  turfId: string | null;
  enabled: boolean;
  priceOverride: number | null;
  stock: number | null;
};

/** An add-on as offered to a walk-in (`GET .../turfs/:turfId/addons`). */
export type WalkInAddon = {
  id: string;
  name: string;
  pricingType: AddonPricingType;
  unitPrice: number;
  maxQuantity: number;
  autoApply: AutoApplyRule | null;
};

/** Task 1: the booking JSON plus customer and turf name; no venue summary on owner responses. */
export type OwnerBooking = Omit<BookingJson, 'venue' | 'turf' | 'completedAt' | 'review' | 'reviewableUntil'> & {
  customer: { name: string; phone: string | null; email: string | null } | null;
  turf: { name: string } | null;
  /** The wallet payment the player submitted, if any. `amount` is the whole submission (a group's total). */
  manualPayment: ManualPaymentJson | null;
};

export type ManualPaymentJson = {
  id: string;
  provider: WalletProvider;
  trxId: string;
  amount: number;
  senderNumber: string | null;
  status: 'pending' | 'succeeded' | 'failed';
  submittedAt: string;
};

export type PaymentJson = {
  id: string;
  method: 'card' | 'cash' | 'wallet';
  gateway: string | null;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
  recordedBy: string | null;
  createdAt: string;
};

/** `group`: the other bookings made in the same go (several courts or days), soonest first. */
export type BookingDetail = { booking: OwnerBooking; payments: PaymentJson[]; refunds: RefundJson[]; group?: OwnerBooking[] };

/** The bookings a walk-in made in one go, with their refunds. */
export type BookingGroup = { bookings: OwnerBooking[]; refunds: RefundJson[] };

export type Member = {
  id: string;
  user: { id: string; name: string; email: string | null; phone: string | null };
  role: RoleRef;
  venueIds: VenueScope;
  status: 'active' | 'disabled';
  createdAt: string;
};

export type Role = RoleRef & { system: boolean; permissions: Permission[]; memberCount: number };

export type ActivityItem = {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  venueId: string | null;
  actor: { id: string; name: string | null } | null;
  before: unknown;
  after: unknown;
  at: string;
};

export type ActivityPage = { items: ActivityItem[]; nextBefore: string | null };

export type GatewayView = {
  gateway: 'stripe' | 'sslcommerz';
  connected: boolean;
  enabled: boolean;
  /** The active mode: new payments use its keys. */
  mode: 'test' | 'live' | null;
  /** `publishableKey` is null for SSLCommerz, whose account id is the store id. */
  accounts: Record<'test' | 'live', { accountId: string; publishableKey: string | null } | null>;
  webhookUrl: string;
  webhookEvents: string[];
  updatedAt: string | null;
};

export type PaymentLink = { id: string; amount: number; currency: string; url: string };
