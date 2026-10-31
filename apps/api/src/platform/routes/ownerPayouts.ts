import { Router } from 'express';
import { z } from 'zod';
import { PAYOUT_METHODS, normalizeTrxId, type OwnerPlatformFeeJson } from '@booking/shared';
import { normalizeBdMobile } from '../../auth/normalize';
import { keyHas } from '../../bookings/create';
import type { Config } from '../../config';
import { runInTransaction } from '../../db';
import { AppError } from '../../errors';
import { resolveGeneral } from '../../admin/settings';
import type { AppServices } from '../../services';
import { Owner } from '../../tenancy/owner.model';
import { requirePermission, tenantOf } from '../../tenancy/context';
import { platformBalances } from '../balance';
import { PlatformPayout, payoutJson } from '../payout.model';

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

const exceeds = () => new AppError(400, 'amount_exceeds_balance', 'The amount is more than you can pay now');

/** What the owner owes the platform and how to pay it; mounted on ownerRouter. */
export function ownerPayoutsRouter(config: Config, services: AppServices): Router {
  const router = Router({ mergeParams: true });

  router.get('/platform-fee', requirePermission('settings.edit'), async (req, res) => {
    const { ownerId } = tenantOf(req);
    const [general, balances, payouts] = await Promise.all([
      resolveGeneral(config),
      platformBalances(ownerId),
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
    if (body.method === 'stripe' || !payout[body.method]) {
      throw new AppError(400, 'method_unavailable', 'This payment method is not available');
    }
    if (body.amount < 1) throw exceeds();
    const now = services.now();

    try {
      const created = await runInTransaction(async (session) => {
        // Touch the owner first: two submits at once write-conflict here, and the retry sees the other's payout.
        await Owner.updateOne({ _id: t.ownerId }, { $set: { payoutLockAt: now } }, { session });
        const balance = (await platformBalances(t.ownerId, session)).find((b) => b.currency === body.currency);
        if (!balance || body.amount > balance.payable) throw exceeds();
        const [row] = await PlatformPayout.create(
          [
            {
              ownerId: t.ownerId,
              currency: body.currency,
              amount: body.amount,
              method: body.method,
              trxId,
              senderNumber,
              status: 'pending',
              by: t.userId,
              createdAt: now,
            },
          ],
          { session },
        );
        return row!;
      });
      res.status(201).json(payoutJson(created));
    } catch (err) {
      if (keyHas(err, 'trxId')) throw new AppError(409, 'duplicate_trx', 'This Transaction ID was already used');
      throw err;
    }
  });

  return router;
}
