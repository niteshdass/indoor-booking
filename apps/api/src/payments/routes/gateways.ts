import type { ClientSession } from 'mongoose';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import { runInTransaction } from '../../db';
import type { Config } from '../../config';
import type { AppServices } from '../../services';
import { Booking } from '../../bookings/booking.model';
import { Payment } from '../../bookings/payment.model';
import { logActivity } from '../../tenancy/activityLog.model';
import { requirePermission, tenantOf } from '../../tenancy/context';
import { gatewayFor } from '../gateway';
import { STRIPE_WEBHOOK_EVENTS } from '../stripe';
import { PaymentGatewayAccount, credentialsAad, loadGateway, type PaymentGatewayAccountDoc } from '../gateway.model';
import { seal } from '../secretBox';

const GATEWAYS = ['stripe'] as const;

const putSchema = z
  .object({
    secretKey: z.string().regex(/^(sk|rk)_(test|live)_\S+$/, 'Expected a Stripe secret or restricted key'),
    publishableKey: z.string().regex(/^pk_(test|live)_\S+$/, 'Expected a Stripe publishable key'),
    webhookSecret: z.string().regex(/^whsec_\S+$/, 'Expected a Stripe webhook signing secret'),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((b) => b.secretKey.split('_')[1] === b.publishableKey.split('_')[1], {
    path: ['publishableKey'],
    message: 'Secret and publishable keys must be for the same mode',
  });

const patchSchema = z.object({ enabled: z.boolean() }).strict();

function view(ownerId: string, config: Config, gateway: string, row: PaymentGatewayAccountDoc | null) {
  return {
    gateway,
    connected: !!row,
    enabled: row?.enabled ?? false,
    mode: row?.mode ?? null,
    accountId: row?.accountId ?? null,
    publishableKey: row?.publishableKey ?? null,
    webhookUrl: `${config.apiUrl}/api/v1/webhooks/${gateway}/${ownerId}`,
    webhookEvents: STRIPE_WEBHOOK_EVENTS,
    updatedAt: row ? (row as unknown as { updatedAt: Date }).updatedAt : null,
  };
}

const publicState = (row: { gateway: string; mode: string; accountId: string; enabled: boolean }) => ({
  gateway: row.gateway,
  mode: row.mode,
  accountId: row.accountId,
  enabled: row.enabled,
});

const accountInUse = () =>
  new AppError(409, 'gateway_account_in_use', 'A card payment is still pending on the current account');

/** Pending card payments on `accountId`, and whether any belongs to a live hold (may still be paid). */
async function pendingOn(ownerId: string, accountId: string, now: Date, session: ClientSession | null = null) {
  const pending = await Payment.find({ ownerId, method: 'card', status: 'pending', gatewayAccountId: accountId }).session(session);
  const live =
    pending.length > 0 &&
    !!(await Booking.exists({
      ownerId,
      _id: { $in: pending.map((p) => p.bookingId) },
      status: 'awaiting_payment',
      holdExpiresAt: { $gt: now },
    }).session(session));
  return { pending, live };
}

/**
 * Clears the old account before a switch. A live hold may still be paid there, so it blocks; every
 * other pending card payment is cancelled at the gateway with the old credentials, then failed. A
 * refused cancel (already paid, webhook on the way) blocks too. Runs outside the transaction, which can rerun.
 */
async function releaseAccount(
  ownerId: string,
  old: NonNullable<Awaited<ReturnType<typeof loadGateway>>>,
  now: Date,
): Promise<void> {
  const { pending, live } = await pendingOn(ownerId, old.row.accountId, now);
  if (live) throw accountInUse();
  for (const p of pending) {
    try {
      await old.gateway.cancelPayment(old.creds, {
        kind: p.kind ?? 'intent',
        gatewayRef: p.gatewayRef ?? null,
        linkRef: p.linkRef ?? null,
      });
    } catch {
      throw accountInUse();
    }
    await Payment.updateOne(
      { ownerId, _id: p._id, status: 'pending' },
      { $set: { status: 'failed', failureCode: 'account_switched' } },
    );
  }
}

/** Owner payment-gateway settings; mounted on ownerRouter. Credentials go in sealed and never come back out. */
export function gatewaysRouter(config: Config, services: AppServices): Router {
  const router = Router({ mergeParams: true });

  router.get('/payment-gateways', requirePermission('settings.edit'), async (req, res) => {
    const { ownerId } = tenantOf(req);
    const rows = await PaymentGatewayAccount.find({ ownerId });
    res.json(GATEWAYS.map((g) => view(ownerId, config, g, rows.find((r) => r.gateway === g) ?? null)));
  });

  router.put('/payment-gateways/:gateway', requirePermission('settings.edit'), async (req, res) => {
    const t = tenantOf(req);
    const gateway = gatewayFor(services, String(req.params.gateway));
    if (!gateway) throw new AppError(404, 'not_found', 'Payment gateway not found');
    const body = putSchema.parse(req.body);
    if (!config.paymentsKey) throw new AppError(503, 'payments_unconfigured', 'Payments are not configured on this server');
    const creds = { secretKey: body.secretKey, webhookSecret: body.webhookSecret };
    const { accountId } = await gateway.verifyCredentials(creds);
    const mode = body.secretKey.split('_')[1] as 'test' | 'live';
    const sealed = seal(JSON.stringify(creds), config.paymentsKey, credentialsAad(t.ownerId, gateway.key));
    const old = await loadGateway(t.ownerId, gateway.key, config, services);
    if (old && old.row.accountId !== accountId) await releaseAccount(t.ownerId, old, services.now());

    const row = await runInTransaction(async (session) => {
      const existing = await PaymentGatewayAccount.findOne({ ownerId: t.ownerId, gateway: gateway.key }).session(session);
      // A hold may have started paying on the old account since releaseAccount.
      if (existing && existing.accountId !== accountId) {
        if ((await pendingOn(t.ownerId, existing.accountId, services.now(), session)).live) throw accountInUse();
      }
      const saved = (await PaymentGatewayAccount.findOneAndUpdate(
        { ownerId: t.ownerId, gateway: gateway.key },
        {
          $set: {
            credentialsEncrypted: sealed,
            publishableKey: body.publishableKey,
            accountId,
            mode,
            enabled: body.enabled ?? true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true, session },
      ))!;
      await logActivity(
        t,
        {
          action: 'payment_gateway.connect',
          entity: 'payment_gateway',
          entityId: String(saved._id),
          ...(existing ? { before: publicState(existing) } : {}),
          after: publicState(saved),
        },
        services.now(),
        session,
      );
      return saved;
    });
    res.json({ gateway: view(t.ownerId, config, gateway.key, row) });
  });

  router.patch('/payment-gateways/:gateway', requirePermission('settings.edit'), async (req, res) => {
    const t = tenantOf(req);
    const { enabled } = patchSchema.parse(req.body);
    const key = String(req.params.gateway);
    const row = await runInTransaction(async (session) => {
      const current = await PaymentGatewayAccount.findOne({ ownerId: t.ownerId, gateway: key }).session(session);
      if (!current) throw new AppError(404, 'not_found', 'Payment gateway not connected');
      const before = publicState(current);
      current.enabled = enabled;
      await current.save({ session });
      await logActivity(
        t,
        {
          action: 'payment_gateway.update',
          entity: 'payment_gateway',
          entityId: String(current._id),
          before,
          after: publicState(current),
        },
        services.now(),
        session,
      );
      return current;
    });
    res.json({ gateway: view(t.ownerId, config, key, row) });
  });

  return router;
}
