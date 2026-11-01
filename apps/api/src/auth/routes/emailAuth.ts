import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import { isDuplicateKeyError } from '../../db';
import type { AuthDeps } from '../deps';
import { hashPassword, randomToken, sha256, verifyPassword } from '../crypto';
import { normalizeEmail, normalizePhone } from '../normalize';
import { otpCodeSchema, requestOtp, verifyOtp } from '../otp';
import { PasswordReset } from '../passwordReset.model';
import { issueTokens, revokeAllForUser, sendAuthResponse } from '../tokens';
import { User, assertActive } from '../user.model';

const RESET_TTL_MS = 60 * 60_000;

export const nameSchema = z.string().trim().min(1).max(80);
export const passwordSchema = z.string().min(8).max(128);

const registerOtpSchema = z.object({ phone: z.string() });
const registerSchema = z.object({
  name: nameSchema,
  email: z.string(),
  password: passwordSchema,
  phone: z.string(),
  code: otpCodeSchema,
});
const loginSchema = z.object({ email: z.string(), password: z.string().min(1).max(128) });
const forgotSchema = z.object({ email: z.string() });
const resetSchema = z.object({ token: z.string().min(1), password: passwordSchema });

// Compared against when the email is unknown, so both failure paths cost one scrypt.
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

const emailInUse = () => new AppError(409, 'email_in_use', 'An account with this email already exists');
const phoneInUse = () => new AppError(409, 'phone_in_use', 'An account with this phone number already exists');

const invalidCredentials = () =>
  new AppError(401, 'invalid_credentials', 'Email or password is incorrect');

export function emailAuthRouter({ config, services }: AuthDeps): Router {
  const router = Router();

  // Registration starts with the phone: it is verified before the account exists.
  router.post('/register/otp/request', async (req, res) => {
    const phone = normalizePhone(registerOtpSchema.parse(req.body).phone);
    // Fail before sending an SMS when the number already has an account.
    if (await User.exists({ phone })) throw phoneInUse();
    res.status(202).json(await requestOtp(phone, 'register', services));
  });

  router.post('/register', async (req, res) => {
    const input = registerSchema.parse(req.body);
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    // Checked before the code is used up, so fixing a taken email does not need a new SMS.
    if (await User.exists({ email })) throw emailInUse();
    if (await User.exists({ phone })) throw phoneInUse();
    await verifyOtp(phone, 'register', input.code, services);
    let user;
    try {
      user = await User.create({
        name: input.name,
        email,
        passwordHash: await hashPassword(input.password),
        phone,
        phoneVerified: true,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw Object.hasOwn((err as { keyPattern?: object }).keyPattern ?? {}, 'phone') ? phoneInUse() : emailInUse();
      }
      throw err;
    }
    sendAuthResponse(res, 201, user, await issueTokens(user.id, services, config), config);
  });

  router.post('/login', async (req, res) => {
    const input = loginSchema.parse(req.body);
    const email = normalizeEmail(input.email);
    const user = await User.findOne({ email });
    const ok = await verifyPassword(input.password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user?.passwordHash || !ok) throw invalidCredentials();
    assertActive(user);
    sendAuthResponse(res, 200, user, await issueTokens(user.id, services, config), config);
  });

  // Answers 202 before mailing, whether or not the account exists, so neither the status nor the
  // mail server's latency tells a caller which emails have accounts.
  router.post('/password/forgot', async (req, res) => {
    const email = normalizeEmail(forgotSchema.parse(req.body).email);
    const user = await User.findOne({ email, status: 'active' });
    const token = randomToken();
    if (user) {
      await PasswordReset.create({
        userId: user._id,
        tokenHash: sha256(token),
        expiresAt: new Date(services.now().getTime() + RESET_TTL_MS),
      });
    }
    res.status(202).json({});
    if (!user) return;
    const link = `${config.appUrl}/reset-password?token=${token}`;
    await services.email
      .send({
        to: email,
        subject: 'Reset your password',
        text: `Reset your password: ${link}\nThis link expires in 1 hour. If you did not ask for this, ignore this email.`,
      })
      .catch((err: unknown) => console.error('password reset email failed', err));
  });

  router.post('/password/reset', async (req, res) => {
    const input = resetSchema.parse(req.body);
    const now = services.now();
    const reset = await PasswordReset.findOneAndUpdate(
      { tokenHash: sha256(input.token), usedAt: { $exists: false }, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
    );
    if (!reset) throw new AppError(400, 'invalid_reset_token', 'Reset link is invalid or expired');
    await User.updateOne(
      { _id: reset.userId },
      // Receiving the reset email proves ownership of the address.
      { $set: { passwordHash: await hashPassword(input.password), emailVerified: true } },
    );
    await revokeAllForUser(String(reset.userId), now);
    res.status(204).end();
  });

  return router;
}
