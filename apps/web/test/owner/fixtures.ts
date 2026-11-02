import { DEFAULT_OWNER_SETTINGS, type OwnerReviewJson, type SeriesJson, type SeriesPreview } from '@booking/shared';
import type { PublicUser } from '../../src/lib/types';
import type {
  ActivityItem,
  Member,
  Membership,
  OwnerBooking,
  OwnerInfo,
  OwnerMembership,
  OwnerSlotDay,
  OwnerTurf,
  OwnerVenue,
  Permission,
  Role,
  VenueScope,
} from '../../src/owner/types';
import type { Route } from '../helpers/api';

export const OWNER_ID = 'o1';

export const staffUser: PublicUser = {
  id: 'u-staff',
  name: 'Sam Staff',
  email: 'sam@example.com',
  emailVerified: true,
  phone: null,
  hasPassword: true,
  hasGoogle: false,
  platformAdmin: false,
};

export function membership(over: Partial<Membership> = {}): Membership {
  return {
    id: 'm1',
    role: { id: 'r-manager', key: 'manager', name: 'Manager' },
    permissions: ['booking.view'],
    venueIds: 'all',
    ...over,
  };
}

export function ownerInfo(over: Partial<OwnerInfo> = {}): OwnerInfo {
  return { id: OWNER_ID, name: 'Acme Sports', country: 'BD', defaultCurrency: 'BDT', defaultLocale: 'en', status: 'active', ...over };
}

export function ownerMembership(over: Partial<OwnerMembership> = {}): OwnerMembership {
  return {
    ownerId: OWNER_ID,
    ownerName: 'Acme Sports',
    ownerStatus: 'active',
    role: { id: 'r-manager', key: 'manager', name: 'Manager' },
    permissions: ['booking.view'],
    venueIds: 'all',
    ...over,
  };
}

export function venue(over: Partial<OwnerVenue> = {}): OwnerVenue {
  return {
    id: 'v1',
    name: 'Arena One',
    slug: 'arena-one',
    address: '1 Main Road',
    city: 'Dhaka',
    country: 'BD',
    currency: 'BDT',
    timezone: 'Asia/Dhaka',
    location: { lat: 23.8, lng: 90.4 },
    photos: [],
    amenities: [],
    published: true,
    settings: {},
    effectiveSettings: DEFAULT_OWNER_SETTINGS,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

export function turf(over: Partial<OwnerTurf> = {}): OwnerTurf {
  return {
    id: 't1',
    venueId: 'v1',
    name: 'Pitch A',
    sports: ['football'],
    indoor: true,
    slotLengthMin: 60,
    active: true,
    settings: {},
    pricing: null,
    effectiveSettings: DEFAULT_OWNER_SETTINGS,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

export function slotDay(over: Partial<OwnerSlotDay> = {}): OwnerSlotDay {
  return {
    businessDate: '2026-10-26',
    currency: 'BDT',
    closed: false,
    closedReason: null,
    inWindow: true,
    slots: [
      {
        startAt: '2026-10-26T04:00:00.000Z',
        endAt: '2026-10-26T05:00:00.000Z',
        localStart: '10:00',
        localEnd: '11:00',
        price: 1000,
        status: 'available',
        source: 'hours',
      },
    ],
    ...over,
  };
}

export function ownerBooking(over: Partial<OwnerBooking> = {}): OwnerBooking {
  return {
    id: 'b1',
    reference: 'BK-0001',
    venueId: 'v1',
    turfId: 't1',
    businessDate: '2026-10-26',
    slots: [{ startAt: '2026-10-26T04:00:00.000Z', endAt: '2026-10-26T05:00:00.000Z', price: 1000 }],
    addons: [],
    currency: 'BDT',
    subtotal: 1000,
    addonsTotal: 0,
    total: 1000,
    advanceRequired: 0,
    platformFee: null,
    amountPaid: 0,
    amountRefunded: 0,
    status: 'pending',
    paymentStatus: 'unpaid',
    holdExpiresAt: null,
    source: 'online',
    playerId: 'u1',
    guest: null,
    seriesId: null,
    groupId: null,
    rejectReason: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: '2026-10-25T00:00:00.000Z',
    customer: { name: 'Ada Player', phone: '+8801712345678', email: 'ada@example.com' },
    turf: { name: 'Pitch A' },
    manualPayment: null,
    coupon: null,
    rescheduleCount: 0,
    rescheduledAt: null,
    ...over,
  };
}

export function manualPayment(over: Partial<NonNullable<OwnerBooking['manualPayment']>> = {}): NonNullable<OwnerBooking['manualPayment']> {
  return { id: 'mp1', provider: 'bkash', trxId: 'AB12CD34EF', amount: 1000, senderNumber: '+8801812345678', status: 'pending', submittedAt: '2026-10-25T23:00:00.000Z', ...over };
}

export function member(over: Partial<Member> = {}): Member {
  return {
    id: 'm2',
    user: { id: 'u2', name: 'Mia Manager', email: 'mia@example.com', phone: null },
    role: { id: 'r-manager', key: 'manager', name: 'Manager' },
    venueIds: 'all',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

export function role(over: Partial<Role> = {}): Role {
  return { id: 'r-manager', key: 'manager', name: 'Manager', system: true, permissions: ['booking.view'], memberCount: 1, ...over };
}

/** The three calls `OwnerProvider` makes for `OWNER_ID`. */
export function ownerRoutes(
  opts: { permissions?: Permission[]; venueIds?: VenueScope; venues?: OwnerVenue[] } = {},
): Route[] {
  const permissions = opts.permissions ?? ['booking.view'];
  const venueIds = opts.venueIds ?? 'all';
  return [
    { path: `/owners/${OWNER_ID}`, body: { owner: ownerInfo(), membership: membership({ permissions, venueIds }) } },
    { path: '/me/memberships', body: { memberships: [ownerMembership({ permissions, venueIds })] } },
    { path: `/owners/${OWNER_ID}/venues`, body: { venues: opts.venues ?? [venue()] } },
  ];
}

export function activityItem(over: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'a1',
    action: 'turf.update',
    entity: 'turf',
    entityId: 't1',
    venueId: 'v1',
    actor: { id: 'u1', name: 'Sam Staff' },
    before: null,
    after: null,
    at: '2026-10-25T20:30:00.000Z',
    ...over,
  };
}

export function ownerReview(over: Partial<OwnerReviewJson> = {}): OwnerReviewJson {
  return {
    id: 'r1',
    stars: 4,
    comment: 'Great pitch',
    reviewer: 'Karim H.',
    createdAt: '2026-10-20T10:00:00.000Z',
    edited: false,
    reply: null,
    venueId: 'v1',
    bookingId: 'b1',
    reference: 'BK-0001',
    flag: null,
    flagCleared: false,
    hidden: false,
    ...over,
  };
}

export function seriesPreview(over: Partial<SeriesPreview> = {}): SeriesPreview {
  return {
    currency: 'BDT',
    freeCount: 2,
    total: 2000,
    platformFee: null,
    dates: [
      { date: '2026-10-26', status: 'free', startAt: '2026-10-26T04:00:00.000Z', endAt: '2026-10-26T05:00:00.000Z', price: 1000 },
      { date: '2026-11-02', status: 'clash', reason: 'taken' },
      { date: '2026-11-09', status: 'free', startAt: '2026-11-09T04:00:00.000Z', endAt: '2026-11-09T05:00:00.000Z', price: 1000 },
    ],
    ...over,
  };
}

export function seriesJson(over: Partial<SeriesJson> = {}): SeriesJson {
  return {
    id: 's1',
    venueId: 'v1',
    turfId: 't1',
    status: 'active',
    source: 'walkin',
    pattern: { weekdays: ['mon'], startTime: '10:00', slotCount: 1, firstDate: '2026-10-26', endDate: null, count: 3 },
    currency: 'BDT',
    player: null,
    guest: { name: 'Ada Walker', phone: '+8801712345678' },
    skipped: [],
    respondBy: null,
    declineReason: null,
    createdAt: '2026-10-25T04:00:00.000Z',
    games: [],
    ...over,
  };
}
