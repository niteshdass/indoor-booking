import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { MEMBERSHIP_STATUSES } from '@booking/shared';
import { tenantScoped } from './tenantScoped.plugin';

const { ObjectId } = mongoose.Schema.Types;

const membershipSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    userId: { type: ObjectId, ref: 'User', required: true },
    roleId: { type: ObjectId, ref: 'Role', required: true },
    allVenues: { type: Boolean, default: false },
    venueIds: { type: [ObjectId], default: [] },
    status: { type: String, enum: MEMBERSHIP_STATUSES, default: 'active' },
  },
  { timestamps: true },
);
membershipSchema.index({ ownerId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1 });
membershipSchema.index({ ownerId: 1, roleId: 1 });
membershipSchema.plugin(tenantScoped);

export type MembershipDoc = HydratedDocument<InferSchemaType<typeof membershipSchema>>;
export const Membership = mongoose.model('Membership', membershipSchema);
