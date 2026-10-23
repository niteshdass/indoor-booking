import mongoose, { type ClientSession } from 'mongoose';
import { tenantScoped } from './tenantScoped.plugin';

const { ObjectId, Mixed } = mongoose.Schema.Types;

const activityLogSchema = new mongoose.Schema({
  ownerId: { type: ObjectId, ref: 'Owner', required: true },
  actorId: { type: ObjectId, ref: 'User', required: true },
  /** '<entity>.<verb>', e.g. role.create */
  action: { type: String, required: true },
  entity: { type: String, required: true },
  entityId: { type: ObjectId, required: true },
  venueId: { type: ObjectId },
  before: { type: Mixed },
  after: { type: Mixed },
  at: { type: Date, required: true },
});
activityLogSchema.index({ ownerId: 1, _id: -1 });
activityLogSchema.index({ ownerId: 1, venueId: 1, _id: -1 });
activityLogSchema.plugin(tenantScoped);

export const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

export type ActivityEntry = {
  /** '<entity>.<verb>', e.g. role.create */
  action: string;
  entity: string;
  entityId: string;
  venueId?: string;
  before?: unknown;
  after?: unknown;
};

/** Records who did what; pass the session when the change itself runs in a transaction. */
export async function logActivity(
  actor: { ownerId: string; userId: string },
  entry: ActivityEntry,
  at: Date,
  session?: ClientSession,
): Promise<void> {
  await ActivityLog.create([{ ...entry, ownerId: actor.ownerId, actorId: actor.userId, at }], {
    session,
  });
}
