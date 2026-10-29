import mongoose from 'mongoose';
import { PLATFORM_ACTIONS, type PlatformAction } from '@booking/shared';

const { ObjectId } = mongoose.Schema.Types;

/** What platform admins (and owner applicants) did; platform-wide, so not tenant-scoped. */
const platformLogSchema = new mongoose.Schema({
  actorId: { type: ObjectId, ref: 'User', required: true },
  action: { type: String, enum: PLATFORM_ACTIONS, required: true },
  entity: { type: String, enum: ['owner', 'user', 'review'], required: true },
  entityId: { type: ObjectId, required: true },
  /** The owner the entity belongs to (the owner itself for owner actions). */
  ownerId: { type: ObjectId, ref: 'Owner', default: null },
  reason: { type: String, default: null },
  at: { type: Date, required: true },
});
platformLogSchema.index({ ownerId: 1, _id: -1 });

export const PlatformLog = mongoose.model('PlatformLog', platformLogSchema);

export type PlatformEntry = {
  action: PlatformAction;
  entity: 'owner' | 'user' | 'review';
  entityId: string;
  ownerId?: string | null;
  reason?: string | null;
};

export async function logPlatform(actorId: string, entry: PlatformEntry, at: Date, session?: mongoose.ClientSession): Promise<void> {
  await PlatformLog.create([{ ...entry, actorId, at }], { session });
}
