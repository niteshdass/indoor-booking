import { Booking } from '../bookings/booking.model';
import { Payment } from '../bookings/payment.model';
import { PaymentGatewayAccount } from '../payments/gateway.model';
import { Refund } from '../payments/refund.model';
import { Migration } from './model';

const cross = { crossTenant: true };

export type MigrationStep = { id: string; run(now: Date): Promise<number> };

/** Backfills for databases that predate a schema change; each is idempotent and returns the rows it changed. */
export const MIGRATIONS: MigrationStep[] = [
  {
    // Plan 08 refunds were all gateway refunds. `attempts` is backfilled too: dispatchRefund claims a row on
    // `attempts: <hydrated 0>`, which does not match a missing field.
    id: '2026-10-24-refund-method',
    async run() {
      const method = await Refund.updateMany({ method: { $exists: false } }, { $set: { method: 'card' } }, { ...cross, timestamps: false });
      const attempts = await Refund.updateMany({ attempts: { $exists: false } }, { $set: { attempts: 0 } }, { ...cross, timestamps: false });
      return method.modifiedCount + attempts.modifiedCount;
    },
  },
  {
    // Before Plan 09 the duplicate and late payments carried no `excess` flag.
    id: '2026-10-24-payment-excess',
    async run() {
      const ids = await Refund.distinct('paymentId', { reason: { $in: ['late_payment', 'duplicate_payment'] } }).setOptions(cross);
      const res = await Payment.updateMany({ _id: { $in: ids }, excess: { $ne: true } }, { $set: { excess: true } }, { ...cross, timestamps: false });
      return res.modifiedCount;
    },
  },
  {
    // Bookings completed before Plan 14 have no completedAt; reviewRequestedAt marks their prompt as handled so
    // no backlog goes out on deploy.
    id: '2026-10-25-booking-completed-at',
    async run(now) {
      const res = await Booking.updateMany(
        { status: 'completed', completedAt: null },
        [{ $set: { completedAt: '$endAt', reviewRequestedAt: now } }],
        { ...cross, timestamps: false },
      );
      return res.modifiedCount;
    },
  },
  {
    // Gateways held one set of keys before test and live keys could sit side by side. The old keys move under
    // their mode, and the card payments and refunds taken with them are stamped with it.
    id: '2026-10-26-gateway-modes',
    async run() {
      const rows = await PaymentGatewayAccount.collection.find({ credentialsEncrypted: { $exists: true } }).toArray();
      let changed = 0;
      for (const r of rows) {
        const mode = r.mode as 'test' | 'live';
        await PaymentGatewayAccount.collection.updateOne(
          { _id: r._id },
          {
            $set: { [`keys.${mode}`]: { credentialsEncrypted: r.credentialsEncrypted, publishableKey: r.publishableKey, accountId: r.accountId } },
            $unset: { credentialsEncrypted: '', publishableKey: '', accountId: '' },
          },
        );
        const stamped = { ownerId: r.ownerId, gateway: r.gateway, gatewayAccountId: r.accountId, gatewayMode: null };
        const payments = await Payment.updateMany(stamped, { $set: { gatewayMode: mode } }, { ...cross, timestamps: false });
        const refunds = await Refund.updateMany(stamped, { $set: { gatewayMode: mode } }, { ...cross, timestamps: false });
        changed += 1 + payments.modifiedCount + refunds.modifiedCount;
      }
      return changed;
    },
  },
];

/** Runs each migration not yet recorded, in order; returns the ids it ran. */
export async function runMigrations(now: Date): Promise<string[]> {
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (await Migration.exists({ _id: m.id })) continue;
    const changed = await m.run(now);
    try {
      await Migration.create({ _id: m.id, appliedAt: now, changed });
      ran.push(m.id);
    } catch (err) {
      // Another instance recorded it first; the work was idempotent.
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  return ran;
}
