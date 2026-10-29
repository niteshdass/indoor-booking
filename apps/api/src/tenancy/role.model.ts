import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import {
  PLATFORM_ROLES,
  PLATFORM_ROLE_NAMES,
  SYSTEM_ROLES,
  SYSTEM_ROLE_NAMES,
  type PlatformRoleKey,
  type SystemRoleKey,
} from '@booking/shared';
import { tenantScoped } from './tenantScoped.plugin';

const roleSchema = new mongoose.Schema(
  {
    /** null for system and platform roles. */
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', default: null },
    scope: { type: String, enum: ['owner', 'platform'], default: 'owner' },
    system: { type: Boolean, default: false },
    key: { type: String, enum: [...Object.keys(SYSTEM_ROLES), ...Object.keys(PLATFORM_ROLES)] },
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

/** Owner-side role queries add this so a platform role never shows up, or gets assigned, in an owner. */
export const OWNER_SCOPE = { scope: { $ne: 'platform' } } as const;

/** Upserts the owner/manager/staff roles from SYSTEM_ROLES and the platform roles; safe to run on every start. */
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
  for (const key of Object.keys(PLATFORM_ROLES) as PlatformRoleKey[]) {
    await Role.updateOne(
      { ownerId: null, system: true, key },
      {
        $set: { name: PLATFORM_ROLE_NAMES[key], permissions: [...PLATFORM_ROLES[key]], scope: 'platform' },
      },
      { upsert: true },
    );
  }
}

export async function systemRole(key: SystemRoleKey | PlatformRoleKey): Promise<RoleDoc> {
  const role = await Role.findOne({ ownerId: null, system: true, key });
  if (!role) throw new Error('System roles not seeded');
  return role;
}
