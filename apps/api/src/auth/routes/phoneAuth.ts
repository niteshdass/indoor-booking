import { Router } from 'express';
import { z } from 'zod';
import { isDuplicateKeyError } from '../../db';
import type { AuthDeps } from '../deps';
import { normalizePhone } from '../normalize';
import { requestOtp, verifyOtp } from '../otp';
import { issueTokens, sendAuthResponse } from '../tokens';
import { User, assertActive } from '../user.model';
import { nameSchema } from './emailAuth';

export const otpCodeSchema = z.string().regex(/^\d{6}$/, 'must be 6 digits');
const requestSchema = z.object({ phone: z.string() });
const verifySchema = z.object({ phone: z.string(), code: otpCodeSchema, name: nameSchema.optional() });

export function phoneAuthRouter({ config, services }: AuthDeps): Router {
  const router = Router();

  router.post('/otp/request', async (req, res) => {
    const phone = normalizePhone(requestSchema.parse(req.body).phone);
    res.status(202).json(await requestOtp(phone, 'login', services));
  });

  router.post('/otp/verify', async (req, res) => {
    const input = verifySchema.parse(req.body);
    const phone = normalizePhone(input.phone);
    await verifyOtp(phone, 'login', input.code, services);

    let user = await User.findOne({ phone });
    let status = 200;
    if (!user) {
      try {
        user = await User.create({ phone, phoneVerified: true, name: input.name ?? '' });
        status = 201;
      } catch (err) {
        // A concurrent verify created the account first.
        if (!isDuplicateKeyError(err)) throw err;
        user = await User.findOne({ phone });
        if (!user) throw err;
      }
    }
    assertActive(user);
    if (!user.phoneVerified) {
      user.phoneVerified = true;
      await user.save();
    }
    sendAuthResponse(res, status, user, await issueTokens(user.id, services, config), config);
  });

  return router;
}
