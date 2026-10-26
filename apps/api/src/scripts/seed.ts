import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import {
  addDays,
  localParts,
  paymentStatusFor,
  type AddonPricingType,
  type Amenity,
  type PaymentPolicy,
  type Sport,
  type TurfPricing,
} from '@booking/shared';
import { loadConfig } from '../config';
import { connectDb, disconnectDb, runInTransaction } from '../db';
import { hashPassword } from '../auth/crypto';
import { User } from '../auth/user.model';
import { Owner } from '../tenancy/owner.model';
import { Membership } from '../tenancy/membership.model';
import { Role, ensureSystemRoles, systemRole } from '../tenancy/role.model';
import { createOwner } from '../tenancy/createOwner';
import { Venue, type VenueDoc } from '../venues/venue.model';
import { Turf, type TurfDoc } from '../venues/turf.model';
import { Addon } from '../addons/addon.model';
import { AddonAssignment } from '../addons/assignment.model';
import { Booking, type BookingDoc } from '../bookings/booking.model';
import { Payment } from '../bookings/payment.model';
import { SlotLock } from '../bookings/slotLock.model';
import { createBooking } from '../bookings/create';
import { Review } from '../reviews/review.model';
import { recomputeVenueRating } from '../reviews/rating';
import { Notification } from '../notifications/notification.model';
import { loadDay } from '../schedule/load';

const USAGE = 'Usage: pnpm --filter api seed [--reset] [--owners 40] [--days-back 21] [--days-ahead 14]';

/** Every seeded account signs in with this password. */
const PASSWORD = 'password123';
const EMAIL_DOMAIN = 'seed.local';
/** Venues whose bookings are generated at once; each venue's turfs are independent of the others. */
const PARALLEL_VENUES = 6;

// Deterministic fake data: the same seed gives the same owners, venues, people and booking pattern.
function dice(seed: number) {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    random,
    chance: (p: number) => random() < p,
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!,
    between: (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1)),
    /** k distinct items of xs, in xs order. */
    some: <T>(xs: readonly T[], k: number): T[] =>
      xs
        .map((x) => ({ x, r: random() }))
        .sort((p, q) => p.r - q.r)
        .slice(0, k)
        .map((p) => p.x)
        .sort((p, q) => xs.indexOf(p) - xs.indexOf(q)),
  };
}
type Dice = ReturnType<typeof dice>;
const world = dice(20261026);
const seedOf = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

const FIRST = ['Tanvir', 'Nusrat', 'Arif', 'Farhana', 'Sakib', 'Mehedi', 'Sadia', 'Rafiq', 'Ayesha', 'Imran', 'Tasnim', 'Rakib', 'Mim', 'Shuvo', 'Jannat', 'Fahim', 'Riya', 'Naim', 'Sumaiya', 'Hasib'];
const LAST = ['Ahmed', 'Jahan', 'Hossain', 'Akter', 'Rahman', 'Hasan', 'Islam', 'Uddin', 'Siddiqua', 'Chowdhury', 'Karim', 'Sarkar', 'Talukder', 'Mollah', 'Bhuiyan'];
const RU_NAMES = ['Иван Петров', 'Анна Смирнова', 'Дмитрий Волков', 'Ольга Кузнецова', 'Сергей Иванов', 'Мария Соколова'];
const PLAYER_COUNT = 60;

const GUESTS = [
  { name: 'Kamal Pasha', phone: '+8801811000101' },
  { name: 'Jamal Khan', phone: '+8801811000102' },
  { name: 'Rupa Das', phone: '+8801811000103' },
  { name: 'Сергей Иванов', phone: '+8801811000104' },
  { name: 'Liton Mia', phone: '+8801811000105' },
  { name: 'Shila Rani', phone: '+8801811000106' },
];

const REVIEWS: { stars: number; comment: string | null }[] = [
  { stars: 5, comment: 'Great court, clean changing rooms and the lights are excellent at night.' },
  { stars: 5, comment: 'Booked in a minute, staff had everything ready when we arrived.' },
  { stars: 4, comment: 'Good surface. Parking gets tight on Friday evenings.' },
  { stars: 4, comment: 'Nice place, a bit pricey at peak hours but worth it.' },
  { stars: 5, comment: 'Лучший корт в районе, обязательно вернёмся.' },
  { stars: 4, comment: 'Хорошее покрытие, удобная запись онлайн.' },
  { stars: 3, comment: 'Court was fine but the AC in the lobby was not working.' },
  { stars: 5, comment: null },
  { stars: 4, comment: null },
  { stars: 2, comment: 'Previous group ran over by 15 minutes, we started late.' },
  { stars: 5, comment: 'Rented rackets were in great condition. Will come back.' },
  { stars: 3, comment: 'Turf is getting worn near the goals.' },
];

const REPLIES = [
  'Thanks for playing with us, see you on court again!',
  'Thank you for the feedback, we have spoken to the team about it.',
  'Спасибо за отзыв! Ждём вас снова.',
];

const CANCEL_REASONS = ['Team could not make it', 'Rain on the way', 'Rescheduled', null];

type TurfSpec = { name: string; sports: Sport[]; indoor: boolean; slotLengthMin: number; pricing: TurfPricing };
type AddonSpec = { name: string; pricingType: AddonPricingType; price: number; maxQuantity?: number };
type VenueSpec = {
  name: string;
  slug: string;
  address: string;
  city: string;
  location: [number, number];
  amenities: Amenity[];
  published: boolean;
  settings: Record<string, unknown>;
  turfs: TurfSpec[];
  /** Names from the owner's catalogue offered at this venue. */
  addons: string[];
};
type OwnerSpec = {
  email: string;
  name: string;
  business: string;
  status?: 'active' | 'pending_approval';
  staff: boolean;
  addons: AddonSpec[];
  venues: VenueSpec[];
};

const allWeek = (open: string, close: string) =>
  Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open, close }]));

// Prices in minor units: 150000 = BDT 1,500.
const peak = (base: number, evening: number, weekend: number): TurfPricing => ({
  base,
  rules: [
    { kind: 'weekday', range: { start: '17:00', end: '23:00' }, price: evening },
    { kind: 'weekend', price: weekend },
  ],
});

const REFUNDS = [
  { minHoursBefore: 24, percent: 100 },
  { minHoursBefore: 6, percent: 50 },
];

/** Hand-written owners with well-known logins; the rest are generated. */
const FIXED_OWNERS: OwnerSpec[] = [
  {
    email: `owner@${EMAIL_DOMAIN}`,
    name: 'Rahim Chowdhury',
    business: 'Arena Sports',
    staff: true,
    addons: [
      { name: 'Racket rental', pricingType: 'per_unit', price: 20000, maxQuantity: 4 },
      { name: 'New ball can', pricingType: 'per_unit', price: 45000, maxQuantity: 3 },
      { name: 'Bib set', pricingType: 'per_booking', price: 15000 },
      { name: 'Coach', pricingType: 'per_hour', price: 120000 },
    ],
    venues: [
      {
        name: 'Arena One',
        slug: 'arena-one',
        address: 'House 12, Road 104, Gulshan 2',
        city: 'Dhaka',
        location: [90.4152, 23.7937],
        amenities: ['parking', 'shower', 'locker', 'changing_room', 'cafe', 'wifi', 'floodlights', 'prayer_room'],
        published: true,
        settings: {
          hours: allWeek('07:00', '23:00'),
          weekendDays: ['fri', 'sat'],
          paymentPolicy: { type: 'partial_percent', percent: 20 },
          refundRules: REFUNDS,
        },
        turfs: [
          { name: 'Court 1', sports: ['padel'], indoor: true, slotLengthMin: 60, pricing: peak(150000, 200000, 220000) },
          { name: 'Court 2', sports: ['padel'], indoor: true, slotLengthMin: 60, pricing: peak(150000, 200000, 220000) },
          { name: 'Court 3', sports: ['tennis'], indoor: false, slotLengthMin: 60, pricing: peak(120000, 160000, 180000) },
          { name: 'Futsal A', sports: ['futsal', 'football'], indoor: true, slotLengthMin: 90, pricing: peak(250000, 320000, 350000) },
        ],
        addons: ['Racket rental', 'New ball can', 'Bib set', 'Coach'],
      },
      {
        name: 'Riverside Padel',
        slug: 'riverside-padel',
        address: 'Plot 7, Road 27, Dhanmondi',
        city: 'Dhaka',
        location: [90.3742, 23.7461],
        amenities: ['parking', 'toilets', 'equipment_rental', 'seating', 'floodlights'],
        published: true,
        settings: {
          hours: allWeek('08:00', '22:00'),
          weekendDays: ['fri', 'sat'],
          paymentPolicy: { type: 'none' },
          guestBooking: { allowed: true, requireOtp: true },
        },
        turfs: [
          { name: 'Court 1', sports: ['padel'], indoor: false, slotLengthMin: 60, pricing: peak(100000, 140000, 150000) },
          { name: 'Court 2', sports: ['padel', 'pickleball'], indoor: false, slotLengthMin: 60, pricing: peak(100000, 140000, 150000) },
        ],
        addons: ['Racket rental', 'New ball can'],
      },
      {
        name: 'Arena Bashundhara',
        slug: 'arena-bashundhara',
        address: 'Block C, Bashundhara R/A',
        city: 'Dhaka',
        location: [90.4318, 23.8193],
        amenities: ['parking', 'toilets'],
        published: false,
        settings: { hours: allWeek('09:00', '21:00') },
        turfs: [{ name: 'Main pitch', sports: ['football'], indoor: false, slotLengthMin: 60, pricing: peak(200000, 260000, 280000) }],
        addons: ['Bib set'],
      },
    ],
  },
  {
    email: `owner2@${EMAIL_DOMAIN}`,
    name: 'Karim Mahmud',
    business: 'Kick Zone',
    staff: true,
    addons: [
      { name: 'Bib set', pricingType: 'per_booking', price: 10000 },
      { name: 'Water bottles (6)', pricingType: 'per_unit', price: 18000, maxQuantity: 5 },
      { name: 'Cricket kit', pricingType: 'per_booking', price: 30000 },
    ],
    venues: [
      {
        name: 'Kick Zone Uttara',
        slug: 'kick-zone-uttara',
        address: 'Sector 7, Road 18, Uttara',
        city: 'Dhaka',
        location: [90.3984, 23.8686],
        amenities: ['parking', 'changing_room', 'toilets', 'floodlights', 'first_aid', 'seating'],
        published: true,
        settings: {
          hours: allWeek('06:00', '00:00'),
          weekendDays: ['fri', 'sat'],
          paymentPolicy: { type: 'partial_percent', percent: 30 },
          refundRules: [{ minHoursBefore: 12, percent: 100 }],
        },
        turfs: [
          { name: 'Turf 1', sports: ['football', 'futsal'], indoor: false, slotLengthMin: 60, pricing: peak(180000, 240000, 260000) },
          { name: 'Turf 2', sports: ['football', 'cricket'], indoor: false, slotLengthMin: 60, pricing: peak(180000, 240000, 260000) },
          { name: 'Box cricket', sports: ['cricket'], indoor: true, slotLengthMin: 60, pricing: peak(160000, 200000, 220000) },
        ],
        addons: ['Bib set', 'Water bottles (6)', 'Cricket kit'],
      },
    ],
  },
];

/** Neighbourhoods venues are spread over: [area, city, lng, lat]. */
const AREAS: [string, string, number, number][] = [
  ['Gulshan 1', 'Dhaka', 90.4165, 23.7808],
  ['Banani', 'Dhaka', 90.4043, 23.7937],
  ['Baridhara', 'Dhaka', 90.4226, 23.7999],
  ['Dhanmondi', 'Dhaka', 90.3742, 23.7461],
  ['Mohammadpur', 'Dhaka', 90.3586, 23.7662],
  ['Mirpur 10', 'Dhaka', 90.3687, 23.8069],
  ['Mirpur DOHS', 'Dhaka', 90.3654, 23.8366],
  ['Uttara Sector 11', 'Dhaka', 90.3897, 23.8759],
  ['Bashundhara R/A', 'Dhaka', 90.4318, 23.8193],
  ['Badda', 'Dhaka', 90.4262, 23.7805],
  ['Rampura', 'Dhaka', 90.4214, 23.7613],
  ['Khilgaon', 'Dhaka', 90.4275, 23.7517],
  ['Motijheel', 'Dhaka', 90.4176, 23.7330],
  ['Tejgaon', 'Dhaka', 90.3925, 23.7639],
  ['Mohakhali DOHS', 'Dhaka', 90.3962, 23.7836],
  ['Shyamoli', 'Dhaka', 90.3657, 23.7746],
  ['Wari', 'Dhaka', 90.4194, 23.7194],
  ['Purbachal', 'Dhaka', 90.5039, 23.8411],
  ['Agrabad', 'Chattogram', 91.8094, 22.3245],
  ['Nasirabad', 'Chattogram', 91.8205, 22.3666],
  ['Halishahar', 'Chattogram', 91.7832, 22.3367],
  ['GEC Circle', 'Chattogram', 91.8227, 22.3590],
  ['Zindabazar', 'Sylhet', 91.8687, 24.8949],
  ['Upashahar', 'Sylhet', 91.8833, 24.8888],
  ['Sonadanga', 'Khulna', 89.5403, 22.8156],
  ['Shaheb Bazar', 'Rajshahi', 88.5998, 24.3654],
  ['Narayanganj Sadar', 'Narayanganj', 90.4991, 23.6238],
  ['Gazipur Chowrasta', 'Gazipur', 90.4125, 24.0023],
];

const BRAND_A = ['Goal', 'Smash', 'Striker', 'Net', 'Ace', 'Rally', 'Green', 'Urban', 'Sky', 'Royal', 'Metro', 'Galaxy', 'Champion', 'Victory', 'Prime', 'Red Card', 'Hat-trick', 'Baseline', 'Corner Flag', 'Golden'];
const BRAND_B = ['Sports', 'Arena', 'Club', 'Hub', 'Zone', 'Park', 'Point', 'Grounds', 'Centre', 'Complex'];
const OWNER_NAMES = ['Shafiq', 'Jahid', 'Monir', 'Selim', 'Rubel', 'Nasir', 'Babul', 'Shamim', 'Faruk', 'Habib', 'Lipi', 'Rokeya', 'Shirin', 'Kazi', 'Anwar'];

type Kind = {
  label: string;
  court: (i: number) => string;
  courts: [number, number];
  sports: Sport[][];
  indoor: number;
  slotLengthMin: number[];
  price: [number, number];
  amenities: Amenity[];
  addons: AddonSpec[];
};
const KINDS: Kind[] = [
  {
    label: 'Football Turf',
    court: (i) => `Turf ${i}`,
    courts: [1, 3],
    sports: [['football'], ['football', 'futsal'], ['football', 'cricket']],
    indoor: 0.1,
    slotLengthMin: [60, 60, 90],
    price: [150000, 280000],
    amenities: ['parking', 'changing_room', 'toilets', 'floodlights', 'first_aid', 'seating', 'shower'],
    addons: [
      { name: 'Bib set', pricingType: 'per_booking', price: 10000 },
      { name: 'Match ball', pricingType: 'per_booking', price: 15000 },
      { name: 'Water bottles (6)', pricingType: 'per_unit', price: 18000, maxQuantity: 5 },
      { name: 'Referee', pricingType: 'per_hour', price: 80000 },
    ],
  },
  {
    label: 'Futsal',
    court: (i) => `Court ${String.fromCharCode(64 + i)}`,
    courts: [1, 2],
    sports: [['futsal'], ['futsal', 'football']],
    indoor: 0.9,
    slotLengthMin: [60],
    price: [180000, 300000],
    amenities: ['parking', 'changing_room', 'toilets', 'shower', 'locker', 'cafe', 'wifi'],
    addons: [
      { name: 'Bib set', pricingType: 'per_booking', price: 10000 },
      { name: 'Match ball', pricingType: 'per_booking', price: 15000 },
    ],
  },
  {
    label: 'Cricket Box',
    court: (i) => `Box ${i}`,
    courts: [1, 2],
    sports: [['cricket']],
    indoor: 0.6,
    slotLengthMin: [60, 120],
    price: [140000, 240000],
    amenities: ['parking', 'toilets', 'floodlights', 'seating', 'equipment_rental'],
    addons: [
      { name: 'Cricket kit', pricingType: 'per_booking', price: 30000 },
      { name: 'Bowling machine', pricingType: 'per_hour', price: 60000 },
    ],
  },
  {
    label: 'Padel Club',
    court: (i) => `Court ${i}`,
    courts: [2, 4],
    sports: [['padel'], ['padel', 'pickleball']],
    indoor: 0.5,
    slotLengthMin: [60, 90],
    price: [90000, 180000],
    amenities: ['parking', 'shower', 'locker', 'cafe', 'wifi', 'equipment_rental', 'floodlights'],
    addons: [
      { name: 'Racket rental', pricingType: 'per_unit', price: 20000, maxQuantity: 4 },
      { name: 'New ball can', pricingType: 'per_unit', price: 45000, maxQuantity: 3 },
      { name: 'Coach', pricingType: 'per_hour', price: 120000 },
    ],
  },
  {
    label: 'Badminton Hall',
    court: (i) => `Court ${i}`,
    courts: [3, 6],
    sports: [['badminton'], ['badminton', 'table_tennis']],
    indoor: 1,
    slotLengthMin: [60],
    price: [40000, 90000],
    amenities: ['toilets', 'changing_room', 'seating', 'equipment_rental', 'wifi'],
    addons: [
      { name: 'Racket rental', pricingType: 'per_unit', price: 10000, maxQuantity: 4 },
      { name: 'Shuttle tube', pricingType: 'per_unit', price: 35000, maxQuantity: 2 },
    ],
  },
  {
    label: 'Tennis Centre',
    court: (i) => `Court ${i}`,
    courts: [1, 3],
    sports: [['tennis'], ['tennis', 'pickleball']],
    indoor: 0.2,
    slotLengthMin: [60],
    price: [80000, 160000],
    amenities: ['parking', 'shower', 'locker', 'floodlights', 'seating'],
    addons: [
      { name: 'Racket rental', pricingType: 'per_unit', price: 20000, maxQuantity: 4 },
      { name: 'Ball machine', pricingType: 'per_hour', price: 50000 },
      { name: 'Coach', pricingType: 'per_hour', price: 100000 },
    ],
  },
  {
    label: 'Multi-sport',
    court: (i) => `Hall ${i}`,
    courts: [2, 3],
    sports: [['basketball', 'volleyball'], ['basketball'], ['volleyball', 'badminton'], ['squash']],
    indoor: 1,
    slotLengthMin: [60],
    price: [60000, 150000],
    amenities: ['toilets', 'changing_room', 'shower', 'locker', 'first_aid', 'prayer_room'],
    addons: [{ name: 'Ball hire', pricingType: 'per_booking', price: 8000 }],
  },
];

const HOURS: [string, string][] = [['06:00', '23:00'], ['07:00', '00:00'], ['08:00', '22:00'], ['09:00', '23:00'], ['15:00', '02:00']];
const POLICIES: PaymentPolicy[] = [
  { type: 'none' },
  { type: 'none' },
  { type: 'partial_percent', percent: 20 },
  { type: 'partial_percent', percent: 25 },
  { type: 'partial_percent', percent: 30 },
  { type: 'full' },
];

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Rounds minor units to whole BDT 50. */
const round50 = (n: number) => Math.round(n / 5000) * 5000;

/** Owners 3..n: a brand with 1-4 venues of one or two kinds, mostly in Dhaka. */
function generatedOwners(count: number, taken: Set<string>): OwnerSpec[] {
  const out: OwnerSpec[] = [];
  const unique = (s: string) => {
    let slug = slugify(s);
    for (let i = 2; taken.has(slug); i++) slug = `${slugify(s)}-${i}`;
    taken.add(slug);
    return slug;
  };
  for (let n = 3; n <= count; n++) {
    const brand = `${world.pick(BRAND_A)} ${world.pick(BRAND_B)}`;
    const venueCount = world.pick([1, 1, 1, 1, 1, 2, 2, 2, 3, 4]);
    const kinds = world.some(KINDS, world.chance(0.3) ? 2 : 1);
    const addons = [...new Map(kinds.flatMap((k) => k.addons).map((a) => [a.name, a])).values()];
    const pending = world.chance(0.08);
    const areas = world.some(AREAS, venueCount);
    const venues = areas.map(([area, city, lng, lat], i): VenueSpec => {
      const kind = kinds[i % kinds.length]!;
      const name = venueCount === 1 ? brand : `${brand} ${area}`;
      const base = round50(world.between(kind.price[0], kind.price[1]));
      const evening = round50(base * (1.2 + world.random() * 0.2));
      const weekend = round50(base * (1.3 + world.random() * 0.2));
      const policy = world.pick(POLICIES);
      const [open, close] = world.pick(HOURS);
      return {
        name,
        slug: unique(`${brand} ${area}`),
        address: `${world.between(1, 120)}, Road ${world.between(1, 40)}, ${area}`,
        city,
        // Jitter within ~1 km so venues in one area don't stack on the map.
        location: [lng + (world.random() - 0.5) * 0.02, lat + (world.random() - 0.5) * 0.02],
        amenities: world.some(kind.amenities, world.between(2, kind.amenities.length)),
        published: !pending && world.chance(0.92),
        settings: {
          hours: allWeek(open, close),
          weekendDays: ['fri', 'sat'],
          paymentPolicy: policy,
          ...(policy.type === 'none' ? { guestBooking: { allowed: world.chance(0.7), requireOtp: true } } : {}),
          ...(world.chance(0.6) ? { refundRules: world.pick([REFUNDS, [{ minHoursBefore: 12, percent: 100 }]]) } : {}),
        },
        turfs: Array.from({ length: world.between(kind.courts[0], kind.courts[1]) }, (_, t) => ({
          name: kind.court(t + 1),
          sports: world.pick(kind.sports),
          indoor: world.chance(kind.indoor),
          slotLengthMin: world.pick(kind.slotLengthMin),
          pricing: peak(base, evening, weekend),
        })),
        addons: world.some(kind.addons, world.between(1, kind.addons.length)).map((a) => a.name),
      };
    });
    out.push({
      email: `owner${n}@${EMAIL_DOMAIN}`,
      name: `${world.pick(OWNER_NAMES)} ${world.pick(LAST)}`,
      business: brand,
      status: pending ? 'pending_approval' : 'active',
      staff: venueCount > 1 || world.chance(0.3),
      addons,
      venues,
    });
  }
  return out;
}

type Person = { id: string };
type Seeded = { venue: VenueDoc; turfs: TurfDoc[]; addonIds: string[]; deskId: string; ownerUserId: string };

async function newUser(email: string, name: string, phone: string | null, passwordHash: string) {
  return User.create({ name, email, emailVerified: true, passwordHash, phone, phoneVerified: phone !== null });
}

/** Empties every collection the app writes, keeping the database itself and its migration record. */
async function reset(): Promise<void> {
  const db = mongoose.connection.db!;
  for (const c of await db.collections()) if (c.collectionName !== 'migrations') await c.deleteMany({});
}

async function seedOwner(spec: OwnerSpec, passwordHash: string, now: Date): Promise<Seeded[]> {
  const user = await newUser(spec.email, spec.name, null, passwordHash);
  const { owner } = await createOwner(
    { userId: user.id as string, name: spec.business, country: 'BD', currency: 'BDT' },
    now,
  );
  if (spec.status && spec.status !== owner.status) {
    owner.status = spec.status;
    await owner.save();
  }
  const ownerId = owner.id as string;

  // Without front-desk staff the owner takes walk-ins at the desk.
  let deskId = user.id as string;
  if (spec.staff) {
    const staff = await newUser(`staff.${spec.email}`, `${spec.business} Front Desk`, null, passwordHash);
    await Membership.create({ ownerId, userId: staff._id, roleId: (await systemRole('staff'))._id, allVenues: true });
    deskId = staff.id as string;
  }

  const addons = new Map<string, string>();
  for (const a of spec.addons) {
    const doc = await Addon.create({ ownerId, currency: 'BDT', maxQuantity: a.maxQuantity ?? 10, ...a });
    addons.set(a.name, doc.id as string);
  }

  const out: Seeded[] = [];
  for (const v of spec.venues) {
    const venue = await Venue.create({
      ownerId,
      name: v.name,
      slug: v.slug,
      address: v.address,
      city: v.city,
      country: 'BD',
      currency: 'BDT',
      timezone: 'Asia/Dhaka',
      location: { type: 'Point', coordinates: v.location },
      photos: [1, 2, 3].map((i) => ({ url: `https://picsum.photos/seed/${v.slug}-${i}/1200/800`, alt: `${v.name} ${i}` })),
      amenities: v.amenities,
      published: v.published,
      settings: v.settings,
    });
    const turfs: TurfDoc[] = [];
    for (const t of v.turfs) turfs.push(await Turf.create({ ownerId, venueId: venue._id, active: true, settings: {}, ...t }));
    const addonIds = v.addons.map((name) => addons.get(name)!);
    for (const addonId of addonIds) {
      await AddonAssignment.create({ ownerId, addonId, venueId: venue._id, turfId: null, enabled: true });
    }
    out.push({ venue, turfs, addonIds, deskId, ownerUserId: user.id as string });
  }
  return out;
}

/** How busy an hour is: evenings and weekends fill up, mornings stay quiet. */
function demand(hm: string, weekend: boolean): number {
  const h = Number(hm.slice(0, 2));
  const base = h >= 17 && h < 22 ? 0.55 : h >= 7 && h < 10 ? 0.25 : 0.15;
  return Math.min(0.85, base + (weekend ? 0.2 : 0));
}

/** Moves a just-created booking to where it would be by `now`: paid, played, cancelled, reviewed. */
async function settle(b: BookingDoc, s: Seeded, now: Date, d: Dice, stats: Record<string, number>) {
  const ownerId = s.venue.ownerId;
  const pay = async (method: 'card' | 'cash', amount: number, at: Date) => {
    if (amount <= 0) return;
    await Payment.create({
      ownerId,
      venueId: b.venueId,
      bookingId: b._id,
      currency: b.currency,
      method,
      amount,
      status: 'succeeded',
      ...(method === 'card'
        ? { gateway: 'stripe', kind: 'intent', gatewayRef: `pi_seed_${String(b._id)}` }
        : { recordedBy: s.deskId }),
      createdAt: at,
      updatedAt: at,
    });
    b.amountPaid += amount;
    b.paymentStatus = paymentStatusFor(b.amountPaid, b.total);
  };

  // An online advance: the card payment went through when the player booked.
  if (b.status === 'awaiting_payment') {
    await pay('card', b.advanceRequired, b.createdAt);
    b.status = 'confirmed';
    b.holdExpiresAt = null;
  }
  // The venue approved a guest's request.
  if (b.status === 'pending' && (b.startAt < now || d.chance(0.4))) b.status = 'confirmed';

  if (d.chance(b.endAt < now ? 0.1 : 0.07)) {
    b.status = 'cancelled';
    b.cancelledBy = b.playerId ? 'player' : b.guest && b.source === 'online' ? 'guest' : 'staff';
    b.cancelledAt = new Date(Math.min(b.startAt.getTime() - 3 * 3_600_000, now.getTime()));
    b.cancelReason = d.pick(CANCEL_REASONS);
    await SlotLock.deleteMany({ ownerId, bookingId: b._id });
  } else if (b.endAt < now && b.status === 'confirmed') {
    if (d.chance(0.06)) {
      b.status = 'no_show';
    } else {
      b.status = 'completed';
      b.completedAt = b.endAt;
      // The balance is settled at the desk.
      await pay('cash', b.total - b.amountPaid, b.startAt);
    }
  }
  await b.save();
  stats[b.status] = (stats[b.status] ?? 0) + 1;

  if (b.status === 'completed' && b.playerId && d.chance(0.55)) {
    const r = d.pick(REVIEWS);
    const at = new Date(b.endAt.getTime() + d.between(1, 48) * 3_600_000);
    if (at > now) return;
    await Review.create({
      ownerId,
      venueId: b.venueId,
      bookingId: b._id,
      playerId: b.playerId,
      stars: r.stars,
      comment: r.comment,
      reply: d.chance(0.4)
        ? { text: d.pick(REPLIES), by: s.ownerUserId, at: new Date(Math.min(at.getTime() + 6 * 3_600_000, now.getTime())) }
        : null,
      createdAt: at,
      updatedAt: at,
    });
    b.reviewedAt = at;
    b.reviewRequestedAt = b.endAt;
    await b.save();
    stats.reviews = (stats.reviews ?? 0) + 1;
  }
}

async function seedBookings(s: Seeded, players: Person[], daysBack: number, daysAhead: number, now: Date) {
  const stats: Record<string, number> = {};
  const { venue } = s;
  // Each venue rolls its own dice, so running venues in parallel keeps the outcome deterministic.
  const d = dice(seedOf(venue.slug));
  // Some venues are simply busier than others.
  const popularity = 0.35 + d.random() * 0.65;
  const ownerId = String(venue.ownerId);
  const today = localParts(now, venue.timezone).date;
  const settings = venue.settings as { weekendDays?: string[]; paymentPolicy?: { type: string }; guestBooking?: { allowed: boolean } };
  const weekend = settings.weekendDays ?? ['sat', 'sun'];
  const guestsAllowed = settings.paymentPolicy?.type === 'none' && settings.guestBooking?.allowed !== false;

  for (const turf of s.turfs) {
    for (let day = -daysBack; day <= daysAhead; day++) {
      const date = addDays(today, day);
      // Booked the evening before, so every slot of the day is still open to the booking.
      const bookedAt = new Date(Math.min(now.getTime(), Date.parse(`${addDays(date, -1)}T14:00:00Z`)));
      const grid = (await loadDay(ownerId, venue, turf, date, bookedAt)).day.slots;
      const isWeekend = weekend.includes(
        new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toLowerCase(),
      );
      // The further ahead, the emptier the grid.
      const fade = day > 0 ? Math.max(0.25, 1 - day / (daysAhead + 2)) : 1;
      for (let i = 0; i < grid.length; i++) {
        const slot = grid[i]!;
        if (slot.status !== 'available' || !d.chance(demand(slot.localStart, isWeekend) * fade * popularity)) continue;
        const length = d.chance(0.3) && grid[i + 1]?.status === 'available' ? 2 : 1;
        const startAts = grid.slice(i, i + length).map((x) => x.startAt);
        i += length - 1;

        const kind = guestsAllowed && d.chance(0.2) ? 'guest' : d.chance(0.25) ? 'walkin' : 'player';
        const player = d.pick(players);
        const guest = d.pick(GUESTS);
        const selection = s.addonIds.filter(() => d.chance(0.2)).map((addonId) => ({ addonId, quantity: 1 }));
        try {
          const booking = await createBooking({
            venue,
            turf,
            date,
            startAts,
            selection,
            source: kind === 'walkin' ? 'walkin' : 'online',
            now: kind === 'walkin' ? new Date(Math.min(now.getTime(), startAts[0]!.getTime() - 600_000)) : bookedAt,
            who:
              kind === 'player'
                ? { playerId: player.id, guest: null, createdBy: player.id }
                : { playerId: null, guest, createdBy: kind === 'walkin' ? s.deskId : null },
            ...(kind === 'walkin' ? { cash: { recordedBy: s.deskId } } : {}),
          });
          await settle(booking, s, now, d, stats);
        } catch (err) {
          // A slot the app turns down (e.g. a walk-in on a slot already under way) is left empty.
          if (err instanceof Error && 'code' in err) {
            stats.skipped = (stats.skipped ?? 0) + 1;
            continue;
          }
          throw err;
        }
      }
    }
  }
  return stats;
}

/** Runs `work` over `items`, at most `limit` at a time, keeping the input order in the result. */
async function inBatches<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      reset: { type: 'boolean', default: false },
      owners: { type: 'string', default: '40' },
      'days-back': { type: 'string', default: '21' },
      'days-ahead': { type: 'string', default: '14' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const ownerCount = Number(values.owners);
  const daysBack = Number(values['days-back']);
  const daysAhead = Number(values['days-ahead']);
  if (!Number.isInteger(ownerCount) || ownerCount < FIXED_OWNERS.length || ownerCount > 500) {
    console.error(`--owners must be between ${FIXED_OWNERS.length} and 500`);
    return 1;
  }
  if (!Number.isInteger(daysBack) || !Number.isInteger(daysAhead) || daysBack < 0 || daysAhead < 0 || daysAhead > 29) {
    console.error('--days-back must be >= 0 and --days-ahead between 0 and 29');
    return 1;
  }
  const config = loadConfig(process.env);
  if (config.nodeEnv === 'production') {
    console.error('Refusing to seed with NODE_ENV=production');
    return 1;
  }
  await connectDb(config.mongodbUri);
  try {
    const users = await User.estimatedDocumentCount();
    if (users > 0 && !values.reset) {
      console.error(`Database already has ${users} users. Re-run with --reset to wipe it first.`);
      return 1;
    }
    if (values.reset) await reset();
    await Promise.all(
      [User, Owner, Role, Membership, Venue, Turf, Addon, AddonAssignment, Booking, Payment, SlotLock, Review].map((m) =>
        (m as typeof User).init(),
      ),
    );
    await ensureSystemRoles();

    const now = new Date();
    const passwordHash = await hashPassword(PASSWORD);
    const players: Person[] = [];
    for (let i = 1; i <= PLAYER_COUNT; i++) {
      const name = i % 10 === 0 ? RU_NAMES[(i / 10 - 1) % RU_NAMES.length]! : `${world.pick(FIRST)} ${world.pick(LAST)}`;
      const user = await newUser(`player${i}@${EMAIL_DOMAIN}`, name, `+88017110${String(i).padStart(5, '0')}`, passwordHash);
      players.push({ id: user.id as string });
    }

    const taken = new Set(FIXED_OWNERS.flatMap((o) => o.venues.map((v) => v.slug)));
    const specs = [...FIXED_OWNERS, ...generatedOwners(ownerCount, taken)];
    const seeded: Seeded[] = [];
    for (const spec of specs) seeded.push(...(await seedOwner(spec, passwordHash, now)));
    console.log(`${specs.length} owners, ${seeded.length} venues, ${seeded.reduce((n, s) => n + s.turfs.length, 0)} turfs`);

    const totals: Record<string, number> = {};
    await inBatches(seeded, PARALLEL_VENUES, async (s) => {
      const stats = s.venue.published ? await seedBookings(s, players, daysBack, daysAhead, now) : {};
      const rating = await runInTransaction((session) =>
        recomputeVenueRating(String(s.venue.ownerId), s.venue.id as string, session),
      );
      for (const [k, n] of Object.entries(stats)) totals[k] = (totals[k] ?? 0) + n;
      const booked = Object.entries(stats).filter(([k]) => k !== 'reviews' && k !== 'skipped').reduce((n, [, v]) => n + v, 0);
      const state = s.venue.published ? `${booked} bookings, rating ${rating.average ?? '-'}` : 'unpublished';
      console.log(`  ${s.venue.name} (/${s.venue.slug}): ${s.turfs.length} turfs, ${state}`);
    });
    // createBooking queued confirmations to fake addresses; nobody should receive them.
    await Notification.deleteMany({}).setOptions({ crossTenant: true });

    console.log(`\nTotals: ${Object.entries(totals).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    console.log(`\nSign in with password "${PASSWORD}":`);
    console.log(`  owners  owner@${EMAIL_DOMAIN} (3 venues), owner2@${EMAIL_DOMAIN}, owner3 … owner${ownerCount}@${EMAIL_DOMAIN}`);
    console.log(`  staff   staff.owner@${EMAIL_DOMAIN}, staff.owner2@${EMAIL_DOMAIN}, staff.ownerN@… where the owner has a desk`);
    console.log(`  players player1 … player${PLAYER_COUNT}@${EMAIL_DOMAIN}`);
    return 0;
  } finally {
    await disconnectDb();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
