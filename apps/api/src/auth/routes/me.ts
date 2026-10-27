import { Router, type Request } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import { isDuplicateKeyError } from '../../db';
import type { AuthDeps } from '../deps';
import { hashPassword } from '../crypto';
import { normalizeEmail, normalizePhone } from '../normalize';
import { requestEmailCode, requestOtp, verifyOtp } from '../otp';
import { requireAuth } from '../requireAuth';
import { User, toPublicUser, type UserDoc } from '../user.model';
import { nameSchema, passwordSchema } from './emailAuth';
import { googleSchema } from './googleAuth';
import { otpCodeSchema } from './phoneAuth';

const patchSchema = z.object({ name: nameSchema });
const phoneSchema = z.object({ phone: z.string() });
const phoneVerifySchema = z.object({ phone: z.string(), code: otpCodeSchema });
const emailSchema = z.object({ email: z.string(), password: passwordSchema });
const emailVerifySchema = z.object({ code: otpCodeSchema });

const identityInUse = () =>
  new AppError(409, 'identity_in_use', 'This sign-in method belongs to another account');

async function currentUser(req: Request): Promise<UserDoc> {
  const user = await User.findById(req.auth?.userId);
  if (!user) throw new AppError(401, 'invalid_token', 'Invalid or expired access token');
  return user;
}

/** Saves an identity change; the partial unique indexes decide races with other accounts. */
async function saveLinked(user: UserDoc): Promise<void> {
  try {
    await user.save();
  } catch (err) {
    if (isDuplicateKeyError(err)) throw identityInUse();
    throw err;
  }
}

export function meRouter({ config, services }: AuthDeps): Router {
  const phoneAlreadySet = () =>
    new AppError(409, 'phone_already_set', 'A different phone number is already linked');
  const router = Router();
  router.use('/me', requireAuth(config, services));

  router.get('/me', async (req, res) => {
    res.json({ user: toPublicUser(await currentUser(req)) });
  });

  router.patch('/me', async (req, res) => {
    const { name } = patchSchema.parse(req.body);
    const user = await currentUser(req);
    user.name = name;
    await user.save();
    res.json({ user: toPublicUser(user) });
  });

  router.post('/me/link/phone/request', async (req, res) => {
    const phone = normalizePhone(phoneSchema.parse(req.body).phone);
    // Changing a verified phone is not linking; that needs its own flow (Plan 10+).
    const user = await currentUser(req);
    if (user.phone && user.phone !== phone) throw phoneAlreadySet();
    // Fail before sending an SMS when the number is someone else's.
    if (await User.exists({ phone, _id: { $ne: req.auth?.userId } })) throw identityInUse();
    res.status(202).json(await requestOtp(phone, 'link', services));
  });

  router.post('/me/link/phone/verify', async (req, res) => {
    const input = phoneVerifySchema.parse(req.body);
    const phone = normalizePhone(input.phone);
    await verifyOtp(phone, 'link', input.code, services);
    const user = await currentUser(req);
    if (user.phone && user.phone !== phone) throw phoneAlreadySet();
    user.phone = phone;
    user.phoneVerified = true;
    await saveLinked(user);
    res.json({ user: toPublicUser(user) });
  });

  router.post('/me/email/verify/request', async (req, res) => {
    const user = await currentUser(req);
    if (!user.email) throw new AppError(409, 'email_not_set', 'This account has no email');
    if (user.emailVerified) throw new AppError(409, 'email_already_verified', 'This email is already verified');
    res.status(202).json(await requestEmailCode(user.email, services));
  });

  router.post('/me/email/verify', async (req, res) => {
    const { code } = emailVerifySchema.parse(req.body);
    const user = await currentUser(req);
    if (!user.email) throw new AppError(409, 'email_not_set', 'This account has no email');
    if (!user.emailVerified) {
      await verifyOtp(user.email, 'verify_email', code, services);
      user.emailVerified = true;
      await user.save();
    }
    res.json({ user: toPublicUser(user) });
  });

  router.post('/me/link/google', async (req, res) => {
    const profile = await services.google.verify(googleSchema.parse(req.body).idToken);
    const user = await currentUser(req);
    if (user.googleSub !== profile.sub) {
      if (user.googleSub) {
        throw new AppError(409, 'google_already_set', 'A different Google account is already linked');
      }
      user.googleSub = profile.sub;
      await saveLinked(user);
    }
    res.json({ user: toPublicUser(user) });
  });

  router.post('/me/link/email', async (req, res) => {
    const input = emailSchema.parse(req.body);
    const email = normalizeEmail(input.email);
    const user = await currentUser(req);
    // A Google user already owns this (verified) email and may add a password to it.
    const addingPassword = user.email === email && !user.passwordHash;
    if (user.email && !addingPassword) {
      throw new AppError(409, 'email_already_set', 'This account already has an email');
    }
    if (!addingPassword) {
      user.email = email;
      user.emailVerified = false;
    }
    user.passwordHash = await hashPassword(input.password);
    await saveLinked(user);
    res.json({ user: toPublicUser(user) });
  });

  return router;
}
