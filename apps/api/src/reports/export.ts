import { addDays, localParts, localToUtc, type PlatformFeeSnapshot } from '@booking/shared';
import { z } from 'zod';
import { User } from '../auth/user.model';
import { Booking, type BookingDoc } from '../bookings/booking.model';
import { Payment, type PaymentDoc } from '../bookings/payment.model';
import { AppError } from '../errors';
import { isoDateSchema } from '../schedule/schemas';
import type { TenantContext } from '../tenancy/context';
import { tenantRepo } from '../tenancy/repo';
import { scopedVenue } from '../venues/routes/venues';
import { Turf } from '../venues/turf.model';
import { Venue, type VenueDoc } from '../venues/venue.model';
import { BOM, csvMoney, csvRow, type Cell } from './csv';

export const EXPORT_MAX_DAYS = 366;
/** Rows one file may hold; past it the caller is asked for a shorter range. */
export const EXPORT_MAX_ROWS = 50_000;

const idQuery = z.string().regex(/^[0-9a-f]{24}$/i, 'Must be an id');

export const exportQuery = z
  .object({ venueId: idQuery.optional(), from: isoDateSchema, to: isoDateSchema })
  .refine((q) => q.to >= q.from, { message: 'to must not be before from', path: ['to'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 + 1 <= EXPORT_MAX_DAYS, {
    message: `Range is at most ${EXPORT_MAX_DAYS} days`,
    path: ['to'],
  });
export type ExportQuery = z.infer<typeof exportQuery>;

export type CsvFile = { filename: string; body: string; rows: number };

const BOOKING_HEADER = [
  'Reference', 'Venue', 'Court', 'Date', 'Start', 'End', 'Status', 'Payment status', 'Source',
  'Customer', 'Phone', 'Email', 'Currency', 'Court price', 'Add-ons', 'Coupon', 'Discount',
  'Platform fee', 'Fee paid by', 'Total', 'Paid', 'Refunded', 'Due', 'Booked at', 'Cancelled at', 'Cancel reason',
];

const PAYMENT_HEADER = [
  'Date', 'Time', 'Booking', 'Venue', 'Court', 'Customer', 'Method', 'Wallet', 'TrxID', 'Gateway ref',
  'Status', 'Currency', 'Amount', 'Refunded', 'Net', 'Excess', 'Recorded by', 'Verified by', 'Verified at',
];

/** The venues the export covers: the one asked for, or every venue the member can see. */
async function venuesOf(t: TenantContext, venueId: string | undefined): Promise<VenueDoc[]> {
  if (venueId) return [await scopedVenue(t, venueId)];
  return Venue.find({ ownerId: t.ownerId, ...(t.venueIds === 'all' ? {} : { _id: { $in: t.venueIds } }) }).sort({ name: 1 });
}

const local = (at: Date | null | undefined, tz: string) => {
  if (!at) return null;
  const p = localParts(at, tz);
  return `${p.date} ${p.hm}`;
};

const fileName = (kind: string, q: ExportQuery, venue: VenueDoc | null) =>
  `${kind}${venue ? `-${venue.slug}` : ''}-${q.from}-to-${q.to}.csv`;

const tooLarge = () =>
  new AppError(400, 'export_too_large', `More than ${EXPORT_MAX_ROWS} rows; pick a shorter range`, { max: EXPORT_MAX_ROWS });

async function namesOf(ids: unknown[]): Promise<Map<string, { name: string; phone: string | null; email: string | null }>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } }).select('name phone email');
  return new Map(users.map((u) => [String(u._id), { name: u.name, phone: u.phone ?? null, email: u.email ?? null }]));
}

async function turfNames(ids: unknown[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return new Map();
  const turfs = await Turf.find({ _id: { $in: unique } }).setOptions({ crossTenant: true }).select('name');
  return new Map(turfs.map((x) => [String(x._id), x.name]));
}

/** Customer of a booking: the player's account, or the guest's name and phone. */
function customerOf(b: BookingDoc, users: Awaited<ReturnType<typeof namesOf>>) {
  if (b.playerId) return users.get(String(b.playerId)) ?? null;
  return b.guest ? { name: b.guest.name, phone: b.guest.phone, email: null } : null;
}

/** Bookings played from `from` to `to` (venue-local dates), soonest first. */
export async function bookingsCsv(t: TenantContext, q: ExportQuery): Promise<CsvFile> {
  const venues = await venuesOf(t, q.venueId);
  const filter = { venueId: { $in: venues.map((v) => v._id) }, businessDate: { $gte: q.from, $lte: q.to } };
  const repo = tenantRepo(Booking, t, { venueField: 'venueId' });
  if ((await repo.countDocuments(filter)) > EXPORT_MAX_ROWS) throw tooLarge();
  const bookings = await repo.find(filter).sort({ startAt: 1, _id: 1 });
  const [users, turfs] = await Promise.all([namesOf(bookings.map((b) => b.playerId)), turfNames(bookings.map((b) => b.turfId))]);
  const venueById = new Map(venues.map((v) => [String(v._id), v]));

  let body = BOM + csvRow(BOOKING_HEADER);
  for (const b of bookings) {
    const v = venueById.get(String(b.venueId))!;
    const tz = v.timezone;
    const c = customerOf(b, users);
    const fee = (b.platformFee ?? null) as PlatformFeeSnapshot | null;
    const money = (n: number) => csvMoney(n, b.currency);
    const row: Cell[] = [
      b.reference,
      v.name,
      turfs.get(String(b.turfId)) ?? null,
      b.businessDate,
      localParts(b.startAt, tz).hm,
      localParts(b.endAt, tz).hm,
      b.status,
      b.paymentStatus,
      b.source,
      c?.name,
      c?.phone,
      c?.email,
      b.currency,
      money(b.subtotal),
      money(b.addonsTotal),
      b.coupon?.code,
      money(b.coupon?.discount ?? 0),
      fee ? money(fee.amount) : null,
      fee?.payer,
      money(b.total),
      money(b.amountPaid),
      money(b.amountRefunded),
      money(Math.max(0, b.total - b.amountPaid)),
      local(b.get('createdAt') as Date, tz),
      local(b.cancelledAt, tz),
      b.cancelReason,
    ];
    body += csvRow(row);
  }
  return { filename: fileName('bookings', q, q.venueId ? venues[0]! : null), body, rows: bookings.length };
}

/** Payments taken from `from` to `to`, by the venue-local day each was recorded, oldest first. */
export async function paymentsCsv(t: TenantContext, q: ExportQuery): Promise<CsvFile> {
  const venues = await venuesOf(t, q.venueId);
  if (!venues.length) return { filename: fileName('payments', q, null), body: BOM + csvRow(PAYMENT_HEADER), rows: 0 };
  // Each venue's days start at its own midnight.
  const filter = {
    $or: venues.map((v) => ({
      venueId: v._id,
      createdAt: { $gte: localToUtc(q.from, 0, v.timezone), $lt: localToUtc(addDays(q.to, 1), 0, v.timezone) },
    })),
  };
  const repo = tenantRepo(Payment, t, { venueField: 'venueId' });
  if ((await repo.countDocuments(filter)) > EXPORT_MAX_ROWS) throw tooLarge();
  const payments: PaymentDoc[] = await repo.find(filter).sort({ createdAt: 1, _id: 1 });
  const bookings = await tenantRepo(Booking, t, { venueField: 'venueId' })
    .find({ _id: { $in: [...new Set(payments.map((p) => String(p.bookingId)))] } })
    .select('reference turfId playerId guest');
  const bookingById = new Map(bookings.map((b) => [String(b._id), b]));
  const [users, turfs] = await Promise.all([
    namesOf([...bookings.map((b) => b.playerId), ...payments.flatMap((p) => [p.recordedBy, p.verifiedBy])]),
    turfNames(bookings.map((b) => b.turfId)),
  ]);
  const venueById = new Map(venues.map((v) => [String(v._id), v]));

  let body = BOM + csvRow(PAYMENT_HEADER);
  for (const p of payments) {
    const v = venueById.get(String(p.venueId))!;
    const at = localParts(p.createdAt, v.timezone);
    const b = bookingById.get(String(p.bookingId));
    const c = b ? customerOf(b, users) : null;
    const money = (n: number) => csvMoney(n, p.currency);
    const row: Cell[] = [
      at.date,
      at.hm,
      b?.reference,
      v.name,
      b ? turfs.get(String(b.turfId)) : null,
      c?.name,
      p.method,
      p.provider,
      p.trxId,
      p.gatewayRef,
      p.status,
      p.currency,
      money(p.amount),
      money(p.refundedAmount),
      money(p.status === 'succeeded' ? p.amount - p.refundedAmount : 0),
      p.excess ? 'yes' : 'no',
      p.recordedBy ? users.get(String(p.recordedBy))?.name : null,
      p.verifiedBy ? users.get(String(p.verifiedBy))?.name : null,
      local(p.verifiedAt, v.timezone),
    ];
    body += csvRow(row);
  }
  return { filename: fileName('payments', q, q.venueId ? venues[0]! : null), body, rows: payments.length };
}
