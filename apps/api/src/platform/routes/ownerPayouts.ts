import { Router } from 'express';
import { z } from 'zod';
import { PAYOUT_METHODS, normalizeTrxId, type OwnerPlatformFeeJson, type OwnerStripePayoutJson, type PayoutMethod } from '@booking/shared';
import { normalizeBdMobile } from '../../auth/normalize';
import { keyHas } from '../../bookings/create';
import type { Config } from '../../config';
import { runInTransaction } from '../../db';
import { AppError } from '../../errors';
import { resolveGeneral } from '../../admin/settings';
import { GatewayError, gatewayFor } from '../../payments/gateway';
import type { AppServices } from '../../services';
import { Owner } from '../../tenancy/owner.model';
import { requirePermission, tenantOf, type TenantContext } from '../../tenancy/context';
import { platformBalances } from '../balance';
import { PlatformPayout, payoutJson, type PlatformPayoutDoc } from '../payout.model';

/** Most recent payouts listed on the owner's platform-fee page. */
const OWNER_PAYOUTS_SHOWN = 50;

const payoutSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/, 'Expected an ISO currency code'),
    amount: z.number().int(),
    method: z.enum(PAYOUT_METHODS),
    trxId: z.string().max(40),
    senderNumber: z.string().max(20),
  })
  .strict();

const stripePayoutSchema = z
  .object({ currency: z.string().regex(/^[A-Z]{3}$/, 'Expected an ISO currency code'), amount: z.number().int() })
  .strict();

const unavailable = () => new AppError(400, 'method_unavailable', 'This payment method is not available');
const duplicate = () => new AppError(409, 'duplicate_trx', 'This Transaction ID was already used');
const exceeds = () => new AppError(400, 'amount_exceeds_balance', 'The amount is more than you can pay now');

/** Writes a pending payout if it fits in what the owner can pay now; throws amount_exceeds_balance otherwise. */
async function createPending(
  t: Pick<TenantContext, 'ownerId' | 'userId'>,
  fields: { currency: string; amount: number; method: PayoutMethod; trxId?: string; senderNumber?: string },
  now: Date,
): Promise<PlatformPayoutDoc> {
  return runInTransaction(async (session) => {
    // Touch the owner first: two submits at once write-conflict here, and the retry sees the other's payout.
    await Owner.updateOne({ _id: t.ownerId }, { $set: { payoutLockAt: now } }, { session });
    const balance = (await platformBalances(t.ownerId, now, session)).find((b) => b.currency === fields.currency);
    if (!balance || fields.amount > balance.payable) throw exceeds();
    const [row] = await PlatformPayout.create([{ ownerId: t.ownerId, ...fields, status: 'pending', by: t.userId, createdAt: now }], { session });
    return row!;
  });
}

/** What the owner owes the platform and how to pay it; mounted on ownerRouter. */
export function ownerPayoutsRouter(config: Config, services: AppServices): Router {
  const router = Router({ mergeParams: true });

  router.get('/platform-fee', requirePermission('settings.edit'), async (req, res) => {
    const { ownerId } = tenantOf(req);
    const [general, balances, payouts] = await Promise.all([
      resolveGeneral(config),
      platformBalances(ownerId, services.now()),
      PlatformPayout.find({ ownerId }).sort({ _id: -1 }).limit(OWNER_PAYOUTS_SHOWN).lean(),
    ]);
    const { bkash, nagad, stripe } = general.payout;
    const body: OwnerPlatformFeeJson = {
      feeActive: general.fee.mode !== 'free',
      payer: general.fee.payer,
      balances,
      payouts: payouts.map((p) => payoutJson(p)),
      methods: { bkash, nagad, stripe: stripe ? { publishableKey: stripe.publishableKey } : null },
    };
    res.json(body);
  });

  /** A bKash or Nagad transfer the owner made to the platform, for an admin to check. */
  router.post('/platform-payouts', requirePermission('settings.edit'), async (req, res) => {
    const t = tenantOf(req);
    const body = payoutSchema.parse(req.body);
    const trxId = normalizeTrxId(body.trxId);
    if (!trxId) throw new AppError(400, 'invalid_trx_id', 'Enter the Transaction ID from your payment message');
    const senderNumber = normalizeBdMobile(body.senderNumber);
    if (!senderNumber) throw new AppError(400, 'invalid_sender', 'Use a Bangladesh mobile number, e.g. 01712345678');
    const { payout } = await resolveGeneral(config);
    // Card payouts go through Stripe, not this form.
    if (body.method === 'stripe' || !payout[body.method]) throw unavailable();
    // Checked first so a reused TrxID reports as such; the unique index still guards the race.
    if (await PlatformPayout.exists({ method: body.method, trxId }).setOptions({ crossTenant: true })) throw duplicate();
    if (body.amount < 1) throw exceeds();
    const now = services.now();

    try {
      const created = await createPending(t, { currency: body.currency, amount: body.amount, method: body.method, trxId, senderNumber }, now);
      res.status(201).json(payoutJson(created));
    } catch (err) {
      if (keyHas(err, 'trxId')) throw duplicate();
      throw err;
    }
  });

  /**
   * A card payment to the admin's Stripe account. The pending payout is written first, under the same lock
   * as the manual form; Stripe is called only after it commits, and its webhook settles the payout.
   */
  router.post('/platform-payouts/stripe', requirePermission('settings.edit'), async (req, res) => {
    const t = tenantOf(req);
    const body = stripePayoutSchema.parse(req.body);
    const { stripe } = (await resolveGeneral(config)).payout;
    const gateway = gatewayFor(services, 'stripe');
    const owner = await Owner.findById(t.ownerId, { country: 1 }).lean();
    if (!stripe || !gateway || !owner || !gateway.supports(owner.country, body.currency)) throw unavailable();
    if (body.amount < 1) throw exceeds();
    const now = services.now();
    const created = await createPending(t, { currency: body.currency, amount: body.amount, method: 'stripe' }, now);
    const payoutId = String(created._id);

    let intent: { gatewayRef: string; clientSecret: string };
    try {
      const made = await gateway.createPayment(stripe.creds, {
        kind: 'intent',
        amount: body.amount,
        currency: body.currency,
        metadata: { payoutId },
        description: 'Platform fee payment',
        idempotencyKey: `payout-${payoutId}`,
      });
      if (!made.gatewayRef || !made.clientSecret) throw new GatewayError('gateway_error');
      intent = { gatewayRef: made.gatewayRef, clientSecret: made.clientSecret };
    } catch (err) {
      // Nothing to pay: free the amount it holds back.
      await PlatformPayout.updateOne(
        { _id: created._id, ownerId: t.ownerId, status: 'pending' },
        { $set: { status: 'rejected', rejectReason: 'stripe_failed' } },
      );
      throw err;
    }
    const payout = await PlatformPayout.findOneAndUpdate(
      { _id: created._id, ownerId: t.ownerId },
      { $set: { stripePaymentIntentId: intent.gatewayRef } },
      { new: true },
    );
    const json: OwnerStripePayoutJson = { payout: payoutJson(payout ?? created), clientSecret: intent.clientSecret, publishableKey: stripe.publishableKey };
    res.status(201).json(json);
  });

  return router;
}
