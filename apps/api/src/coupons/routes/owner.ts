import { Router } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../../errors';
import { isDuplicateKeyError, runInTransaction } from '../../db';
import type { AppServices } from '../../services';
import { logActivity } from '../../tenancy/activityLog.model';
import { permissionsCover, requirePermission, tenantOf, type TenantContext } from '../../tenancy/context';
import { Owner } from '../../tenancy/owner.model';
import { Venue } from '../../venues/venue.model';
import { Coupon, couponJson, type CouponDoc } from '../coupon.model';
import { couponCreateSchema, couponMergedSchema, couponPatchSchema } from '../schemas';
import { couponUses } from '../uses';

const codeTaken = () => new AppError(409, 'coupon_code_taken', 'A coupon with this code already exists');
const isCodeDuplicate = (err: unknown) =>
  isDuplicateKeyError(err) && Object.hasOwn((err as { keyPattern?: object }).keyPattern ?? {}, 'code');
const couponNotFound = () => new AppError(404, 'not_found', 'Coupon not found');

/** Coupons are owner-wide: writing them needs coupon.manage on all venues. */
function assertCouponWriter(t: TenantContext): void {
  if (!permissionsCover(t, ['coupon.manage']) || t.venueIds !== 'all') {
    throw new AppError(403, 'forbidden', 'You do not have permission to do this');
  }
}

async function scopedCoupon(t: TenantContext, couponId: string): Promise<CouponDoc> {
  const coupon = mongoose.isValidObjectId(couponId) ? await Coupon.findOne({ ownerId: t.ownerId, _id: couponId }) : null;
  if (!coupon) throw couponNotFound();
  return coupon;
}

/** Every venue named must be the owner's. */
async function assertVenues(t: TenantContext, venueIds: string[]): Promise<void> {
  const unique = [...new Set(venueIds)];
  if (unique.length === 0) return;
  const found = await Venue.countDocuments({ ownerId: t.ownerId, _id: { $in: unique } });
  if (found !== unique.length) throw new AppError(400, 'validation_error', 'Unknown venue');
}

const toDate = (s: string | null | undefined) => (s === undefined ? undefined : s === null ? null : new Date(s));
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Mounted on ownerRouter. */
export function ownerCouponsRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });

  router.get('/coupons', requirePermission('coupon.manage'), async (req, res) => {
    const t = tenantOf(req);
    const coupons = await Coupon.find({ ownerId: t.ownerId }).sort({ createdAt: -1, _id: -1 });
    const uses = await couponUses(t.ownerId, coupons.map((c) => String(c._id)), services.now());
    res.json({ coupons: coupons.map((c) => couponJson(c, uses.get(String(c._id)) ?? 0)) });
  });

  router.post('/coupons', async (req, res) => {
    const t = tenantOf(req);
    assertCouponWriter(t);
    const input = couponCreateSchema.parse(req.body);
    await assertVenues(t, input.venueIds);
    const owner = (await Owner.findById(t.ownerId, { defaultCurrency: 1 }).lean())!;
    try {
      const coupon = await runInTransaction(async (session) => {
        const [created] = await Coupon.create(
          [
            {
              ...input,
              venueIds: [...new Set(input.venueIds)],
              validFrom: toDate(input.validFrom),
              validUntil: toDate(input.validUntil),
              ownerId: t.ownerId,
              currency: owner.defaultCurrency,
            },
          ],
          { session },
        );
        await logActivity(
          t,
          { action: 'coupon.create', entity: 'coupon', entityId: created!.id as string, after: couponJson(created!, 0) },
          services.now(),
          session,
        );
        return created!;
      });
      res.status(201).json({ coupon: couponJson(coupon, 0) });
    } catch (err) {
      if (isCodeDuplicate(err)) throw codeTaken();
      throw err;
    }
  });

  router.patch('/coupons/:couponId', async (req, res) => {
    const t = tenantOf(req);
    assertCouponWriter(t);
    const patch = couponPatchSchema.parse(req.body);
    const current = await scopedCoupon(t, req.params.couponId as string);
    if (patch.venueIds) await assertVenues(t, patch.venueIds);
    couponMergedSchema.parse({
      type: patch.type ?? current.type,
      value: patch.value ?? current.value,
      validFrom: patch.validFrom !== undefined ? patch.validFrom : iso(current.validFrom),
      validUntil: patch.validUntil !== undefined ? patch.validUntil : iso(current.validUntil),
      maxDiscount: patch.maxDiscount !== undefined ? patch.maxDiscount : current.maxDiscount ?? null,
    });
    const now = services.now();
    try {
      const coupon = await runInTransaction(async (session) => {
        const doc = await Coupon.findOne({ ownerId: t.ownerId, _id: current._id }).session(session);
        if (!doc) throw couponNotFound();
        const before = couponJson(doc, 0) as Record<string, unknown>;
        doc.set({
          ...patch,
          ...(patch.venueIds ? { venueIds: [...new Set(patch.venueIds)] } : {}),
          ...(patch.validFrom !== undefined ? { validFrom: toDate(patch.validFrom) } : {}),
          ...(patch.validUntil !== undefined ? { validUntil: toDate(patch.validUntil) } : {}),
        });
        await doc.save({ session });
        const after = couponJson(doc, 0) as Record<string, unknown>;
        const changed = Object.keys(patch).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
        if (changed.length > 0) {
          await logActivity(
            t,
            {
              action: 'coupon.update',
              entity: 'coupon',
              entityId: doc.id as string,
              before: Object.fromEntries(changed.map((k) => [k, before[k]])),
              after: Object.fromEntries(changed.map((k) => [k, after[k]])),
            },
            now,
            session,
          );
        }
        return doc;
      });
      const uses = await couponUses(t.ownerId, [String(coupon._id)], now);
      res.json({ coupon: couponJson(coupon, uses.get(String(coupon._id)) ?? 0) });
    } catch (err) {
      if (isCodeDuplicate(err)) throw codeTaken();
      throw err;
    }
  });

  // Bookings keep their own copy of the code and discount, so deleting a used coupon is safe.
  router.delete('/coupons/:couponId', async (req, res) => {
    const t = tenantOf(req);
    assertCouponWriter(t);
    const current = await scopedCoupon(t, req.params.couponId as string);
    await runInTransaction(async (session) => {
      await Coupon.deleteOne({ ownerId: t.ownerId, _id: current._id }, { session });
      await logActivity(
        t,
        { action: 'coupon.delete', entity: 'coupon', entityId: current.id as string, before: couponJson(current, 0) },
        services.now(),
        session,
      );
    });
    res.status(204).end();
  });

  return router;
}
