import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { SYSTEM_ROLES, SYSTEM_ROLE_NAMES, type SystemRoleKey } from '@booking/shared';
import { tenantScoped } from './tenantScoped.plugin';

const roleSchema = new mongoose.Schema(
  {
    /** null for system (and later platform) roles. */
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', default: null },
    scope: { type: String, enum: ['owner', 'platform'], default: 'owner' },
    system: { type: Boolean, default: false },
    key: { type: String, enum: Object.keys(SYSTEM_ROLES) },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 50 },
    permissions: { type: [String], default: [] },
  },
  { timestamps: true },
);
roleSchema.index(
  { ownerId: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
roleSchema.index({ key: 1 }, { unique: true, partialFilterExpression: { system: true } });
roleSchema.plugin(tenantScoped);

export type RoleDoc = HydratedDocument<InferSchemaType<typeof roleSchema>>;
export const Role = mongoose.model('Role', roleSchema);

/** Upserts the owner/manager/staff roles from SYSTEM_ROLES; safe to run on every start. */
export async function ensureSystemRoles(): Promise<void> {
  for (const key of Object.keys(SYSTEM_ROLES) as SystemRoleKey[]) {
    await Role.updateOne(
      { ownerId: null, system: true, key },
      {
        $set: { name: SYSTEM_ROLE_NAMES[key], permissions: [...SYSTEM_ROLES[key]], scope: 'owner' },
      },
      { upsert: true },
    );
  }
}

export async function systemRole(key: SystemRoleKey): Promise<RoleDoc> {
  const role = await Role.findOne({ ownerId: null, system: true, key });
  if (!role) throw new Error('System roles not seeded');
  return role;
}
