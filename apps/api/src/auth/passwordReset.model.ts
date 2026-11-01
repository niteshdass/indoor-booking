import mongoose from 'mongoose';
import { TOKEN_TTL_GRACE_SEC } from './ttl';

const passwordResetSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date },
});

// Mongo drops rows a day after expiry; the grace keeps the 'expired' answers and reuse checks working meanwhile.
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: TOKEN_TTL_GRACE_SEC });

export const PasswordReset = mongoose.model('PasswordReset', passwordResetSchema);
