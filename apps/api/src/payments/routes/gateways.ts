import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import { runInTransaction } from '../../db';
import type { Config } from '../../config';
import type { AppServices } from '../../services';
import { Payment } from '../../bookings/payment.model';
import { logActivity } from '../../tenancy/activityLog.model';
import { requirePermission, tenantOf } from '../../tenancy/context';
import { gatewayFor } from '../gateway';
import { PaymentGatewayAccount, credentialsAad, type PaymentGatewayAccountDoc } from '../gateway.model';
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
    updatedAt: row ? (row as unknown as { updatedAt: Date }).updatedAt : null,
  };
}

const publicState = (row: { gateway: string; mode: string; accountId: string; enabled: boolean }) => ({
  gateway: row.gateway,
  mode: row.mode,
  accountId: row.accountId,
  enabled: row.enabled,
});

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

    const row = await runInTransaction(async (session) => {
      const existing = await PaymentGatewayAccount.findOne({ ownerId: t.ownerId, gateway: gateway.key }).session(session);
      if (existing && existing.accountId !== accountId) {
        const pending = await Payment.exists({
          ownerId: t.ownerId,
          method: 'card',
          status: 'pending',
          gatewayAccountId: existing.accountId,
        }).session(session);
        if (pending) {
          throw new AppError(409, 'gateway_account_in_use', 'A card payment is still pending on the current account');
        }
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
