import mongoose from 'mongoose';

/**
 * One doc per phone. `recent` holds the newest send times (newest first, capped at the hourly
 * limit) so cooldown and hourly cap are checked and recorded in one atomic update.
 */
const otpThrottleSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  recent: { type: [Date], default: [] },
});

export const OtpThrottle = mongoose.model('OtpThrottle', otpThrottleSchema);
