import { randomInt } from 'node:crypto';
import { AppError } from '../errors';
import type { AppServices } from '../services';
import { sha256 } from './crypto';
import { OtpCode, type OTP_PURPOSES } from './otp.model';

export type OtpPurpose = (typeof OTP_PURPOSES)[number];

const EXPIRES_SEC = 300;
const RESEND_SEC = 60;
const MAX_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

const hashCode = (phone: string, code: string) => sha256(`${phone}:${code}`);
const defaultCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
const invalid = () => new AppError(400, 'otp_invalid', 'Invalid verification code');

/** `phone` must already be E.164 (normalizePhone). Only the newest code per phone+purpose is live. */
export async function requestOtp(
  phone: string,
  purpose: OtpPurpose,
  services: AppServices,
): Promise<{ expiresInSec: number; resendInSec: number }> {
  const now = services.now();
  const last = await OtpCode.findOne({ phone, purpose }).sort({ createdAt: -1 });
  if (last) {
    const waitMs = last.createdAt.getTime() + RESEND_SEC * 1000 - now.getTime();
    if (waitMs > 0) {
      throw new AppError(429, 'otp_cooldown', 'Please wait before requesting another code', {
        retryInSec: Math.ceil(waitMs / 1000),
      });
    }
  }
  const lastHour = await OtpCode.countDocuments({
    phone,
    createdAt: { $gt: new Date(now.getTime() - 3600_000) },
  });
  if (lastHour >= MAX_PER_HOUR) {
    throw new AppError(429, 'otp_rate_limited', 'Too many codes requested; try again later');
  }
  const code = (services.otpCode ?? defaultCode)();
  await OtpCode.create({
    phone,
    purpose,
    codeHash: hashCode(phone, code),
    createdAt: now,
    expiresAt: new Date(now.getTime() + EXPIRES_SEC * 1000),
  });
  await services.sms.send(phone, `Your verification code is ${code}. It expires in 5 minutes.`);
  return { expiresInSec: EXPIRES_SEC, resendInSec: RESEND_SEC };
}

/** Consumes the code on success; every attempt counts, so the 6th guess fails even if right. */
export async function verifyOtp(
  phone: string,
  purpose: OtpPurpose,
  code: string,
  services: AppServices,
): Promise<void> {
  const now = services.now();
  const latest = await OtpCode.findOne({ phone, purpose }).sort({ createdAt: -1 });
  if (!latest || latest.consumedAt) throw invalid();
  if (latest.expiresAt <= now) throw new AppError(400, 'otp_expired', 'Verification code expired');
  const counted = await OtpCode.findOneAndUpdate(
    { _id: latest._id, consumedAt: { $exists: false }, attempts: { $lt: MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
  );
  if (!counted) {
    throw new AppError(429, 'otp_attempts_exceeded', 'Too many wrong attempts; request a new code');
  }
  if (counted.codeHash !== hashCode(phone, code)) throw invalid();
  const consumed = await OtpCode.updateOne(
    { _id: latest._id, consumedAt: { $exists: false } },
    { $set: { consumedAt: now } },
  );
  if (consumed.modifiedCount !== 1) throw invalid();
}
