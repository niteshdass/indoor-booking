import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { AppError } from '../errors';

/** Unique only among documents where the field is a string, so many users may lack it. */
const uniqueWhenSet = (field: string) => ({
  unique: true,
  partialFilterExpression: { [field]: { $type: 'string' } },
});

const userSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    email: { type: String },
    emailVerified: { type: Boolean, default: false },
    passwordHash: { type: String },
    phone: { type: String },
    phoneVerified: { type: Boolean, default: false },
    googleSub: { type: String },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    /** A platform-scope Role (Super Admin); platform access never comes from a Membership. */
    platformRoleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', default: null },
  },
  { timestamps: true },
);
userSchema.index({ email: 1 }, uniqueWhenSet('email'));
userSchema.index({ phone: 1 }, uniqueWhenSet('phone'));
userSchema.index({ googleSub: 1 }, uniqueWhenSet('googleSub'));

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;

export const User = mongoose.model('User', userSchema);

export type PublicUser = {
  id: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  hasPassword: boolean;
  hasGoogle: boolean;
  platformAdmin: boolean;
};

export function toPublicUser(doc: UserDoc): PublicUser {
  return {
    id: doc.id as string,
    name: doc.name,
    email: doc.email ?? null,
    emailVerified: doc.emailVerified,
    phone: doc.phone ?? null,
    hasPassword: Boolean(doc.passwordHash),
    hasGoogle: Boolean(doc.googleSub),
    platformAdmin: doc.platformRoleId != null,
  };
}

export function assertActive(user: { status: string }): void {
  if (user.status === 'disabled') throw new AppError(403, 'account_disabled', 'Account is disabled');
}
