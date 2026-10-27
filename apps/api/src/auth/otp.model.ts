import mongoose from 'mongoose';

export const OTP_PURPOSES = ['login', 'link', 'guest_booking', 'guest_cancel', 'register', 'verify_email'] as const;

const otpCodeSchema = new mongoose.Schema({
  /** E.164 phone number; for `verify_email`, the email address the code was mailed to. */
  phone: { type: String, required: true },
  purpose: { type: String, enum: OTP_PURPOSES, required: true },
  codeHash: { type: String, required: true },
  // Set from the injected clock, not Mongoose timestamps, so tests control it.
  createdAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  consumedAt: { type: Date },
});
otpCodeSchema.index({ phone: 1, purpose: 1, createdAt: -1 });
otpCodeSchema.index({ phone: 1, createdAt: -1 });

export const OtpCode = mongoose.model('OtpCode', otpCodeSchema);
