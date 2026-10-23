import mongoose from 'mongoose';
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
