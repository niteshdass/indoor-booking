import type { OwnerApprovalMode, PlatformFeeSettings } from './platformFee';
import type { PlatformPermission, PlatformRoleKey } from './permissions';
import type { RatingSummary } from './reviews';
import type { OwnerStatus } from './statuses';
import type { ManualWallet } from './wallets';

export const ADMIN_PAGE_SIZE = 25;
export const ADMIN_REVIEW_PAGE_SIZE = 20;
export const ADMIN_ACTIVITY_PAGE_SIZE = 30;
/** Days covered by the "recent" figures on the admin pages. */
export const ADMIN_PERIOD_DAYS = 30;
export const SUSPEND_REASON_MAX = 500;

export const PLATFORM_ACTIONS = [
  'owner.applied',
  'owner.approved',
  'owner.auto_approved',
  'owner.suspended',
  'owner.reactivated',
  'user.disabled',
  'user.enabled',
  'review.hidden',
  'review.kept',
  'settings.general_updated',
  'payout.confirmed',
  'payout.rejected',
] as const;
export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

export const ADMIN_REVIEW_STATES = ['flagged', 'hidden', 'kept'] as const;
export type AdminReviewState = (typeof ADMIN_REVIEW_STATES)[number];

export type AdminMeJson = { role: { key: PlatformRoleKey | null; name: string }; permissions: PlatformPermission[] };

/** An amount in minor units of `currency`. */
export type CurrencyAmount = { currency: string; amount: number };

export type AdminPersonJson = { id: string; name: string; email: string | null; phone: string | null };

export type AdminOwnerRowJson = {
  id: string;
  name: string;
  country: string;
  currency: string;
  status: OwnerStatus;
  createdAt: string;
  /** The longest-standing active member with the owner role. */
  contact: AdminPersonJson | null;
  venues: number;
  publishedVenues: number;
  /** Bookings made in the last ADMIN_PERIOD_DAYS days. */
  recentBookings: number;
  /**
   * Platform-fee balance per currency; negative is a credit. Only non-zero currencies. Only on the
   * owners list (platform.owners), never on the overview.
   */
  owes?: CurrencyAmount[];
};

export type AdminOverviewJson = {
  owners: Record<OwnerStatus, number>;
  users: { total: number; recent: number; previous: number };
  venues: { total: number; published: number };
  bookings: { recent: number; previous: number };
  /** Earned in the last ADMIN_PERIOD_DAYS days, largest first. */
  earned: CurrencyAmount[];
  /** Platform fees in the same period: owed by bookings, collected by confirmed payouts. */
  fees: { owed: CurrencyAmount[]; collected: CurrencyAmount[] };
  openFlags: number;
  pendingOwners: AdminOwnerRowJson[];
  newestOwners: AdminOwnerRowJson[];
};

export type AdminOwnersJson = {
  owners: AdminOwnerRowJson[];
  total: number;
  counts: Record<OwnerStatus | 'all', number>;
};

export type AdminVenueJson = {
  id: string;
  name: string;
  slug: string;
  city: string;
  published: boolean;
  courts: number;
  rating: RatingSummary | null;
};

export type PlatformLogJson = {
  id: string;
  action: PlatformAction;
  actor: { id: string; name: string } | null;
  entity: 'owner' | 'user' | 'review';
  entityId: string;
  /** Business name, user name, or the review's venue name. */
  target: string | null;
  ownerId: string | null;
  reason: string | null;
  at: string;
};

export type AdminOwnerDetailJson = {
  owner: {
    id: string;
    name: string;
    country: string;
    currency: string;
    locale: string;
    status: OwnerStatus;
    createdAt: string;
  };
  contacts: AdminPersonJson[];
  members: number;
  venues: AdminVenueJson[];
  recent: { bookings: number; earned: CurrencyAmount[] };
  history: PlatformLogJson[];
};

export type AdminUserJson = AdminPersonJson & {
  status: 'active' | 'disabled';
  platformAdmin: boolean;
  teams: number;
  createdAt: string;
};

export type AdminUsersJson = { users: AdminUserJson[]; total: number };

export type AdminReviewJson = {
  id: string;
  stars: number;
  comment: string | null;
  createdAt: string;
  author: string | null;
  venue: { id: string; name: string; slug: string };
  owner: { id: string; name: string };
  flag: { at: string; reason: string | null; by: string | null } | null;
  reply: { text: string; at: string } | null;
  state: AdminReviewState | 'visible';
};

export type AdminReviewsJson = { reviews: AdminReviewJson[]; nextBefore: string | null };

export type PlatformLogPageJson = { entries: PlatformLogJson[]; nextBefore: string | null };

/** Where a delivery or sign-in setting comes from: saved by an admin, the server's environment, or nowhere. */
export type SettingSource = 'admin' | 'server' | 'none';

/** Platform settings as admins see them. Secrets never come back, only whether one is saved. */
export type AdminSettingsJson = {
  google: { source: SettingSource; clientId: string | null };
  email: {
    source: SettingSource;
    smtp: { host: string; port: number; secure: boolean; user: string | null; from: string; passwordSet: boolean } | null;
  };
  sms: { source: SettingSource; twilio: { accountSid: string; from: string; authTokenSet: boolean } | null };
  /** False when the server has no encryption key, so passwords and tokens cannot be saved. */
  secretsAvailable: boolean;
  general: {
    ownerApproval: OwnerApprovalMode;
    fee: PlatformFeeSettings;
    payout: {
      bkash: ManualWallet | null;
      nagad: ManualWallet | null;
      stripe: {
        mode: 'test' | 'live';
        enabled: boolean;
        keys: Record<'test' | 'live', { publishableKey: string; accountId: string } | null>;
      } | null;
    };
    /** Where the payout Stripe account's webhook points. */
    payoutWebhookUrl: string;
  };
  updatedAt: string | null;
  updatedBy: string | null;
};

/** Public sign-in options for the login page. */
export type AuthProvidersJson = { googleClientId: string | null };
