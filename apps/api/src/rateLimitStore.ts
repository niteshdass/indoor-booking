import mongoose from 'mongoose';
import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';

/** One doc per limiter and client; the TTL index drops it once its window is over. */
const rateLimitSchema = new mongoose.Schema({
  _id: { type: String },
  hits: { type: Number, required: true },
  resetAt: { type: Date, required: true },
});
rateLimitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitHit = mongoose.model('RateLimitHit', rateLimitSchema);

type HitDoc = { _id: string; hits: number; resetAt: Date };

/**
 * express-rate-limit store kept in MongoDB, so every API server counts against the same buckets
 * (the default memory store gives each process its own). `prefix` names the limiter.
 */
export class MongoRateLimitStore implements Store {
  windowMs = 60_000;
  // Shared across processes: the library must not assume keys are unique to this instance.
  localKeys = false;

  constructor(readonly prefix: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private id(key: string) {
    return `${this.prefix}:${key}`;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const doc = await RateLimitHit.collection.findOne<HitDoc>({ _id: this.id(key) as never, resetAt: { $gt: new Date() } });
    return doc ? { totalHits: doc.hits, resetTime: doc.resetAt } : undefined;
  }

  /** One atomic update: a live window counts up, a lapsed or missing one starts again at 1. */
  async increment(key: string): Promise<ClientRateLimitInfo> {
    const now = new Date();
    const live = { $gt: ['$resetAt', now] };
    const doc = await RateLimitHit.collection.findOneAndUpdate(
      { _id: this.id(key) as never },
      [
        {
          $set: {
            hits: { $cond: [live, { $add: ['$hits', 1] }, 1] },
            resetAt: { $cond: [live, '$resetAt', new Date(now.getTime() + this.windowMs)] },
          },
        },
      ],
      { upsert: true, returnDocument: 'after' },
    );
    const hit = doc as unknown as HitDoc;
    return { totalHits: hit.hits, resetTime: hit.resetAt };
  }

  async decrement(key: string): Promise<void> {
    await RateLimitHit.collection.updateOne({ _id: this.id(key) as never, hits: { $gt: 0 } }, { $inc: { hits: -1 } });
  }

  async resetKey(key: string): Promise<void> {
    await RateLimitHit.collection.deleteOne({ _id: this.id(key) as never });
  }
}
