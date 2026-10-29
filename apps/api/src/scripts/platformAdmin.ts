import { parseArgs } from 'node:util';
import { loadConfig } from '../config';
import { connectDb, disconnectDb } from '../db';
import { normalizeEmail } from '../auth/normalize';
import { User } from '../auth/user.model';
import { ensureSystemRoles, systemRole } from '../tenancy/role.model';

const USAGE = 'Usage: pnpm --filter api platform-admin --email <registered, verified email> [--revoke]';

/** Grants (or with --revoke, removes) the Super admin platform role; the first admin can only be made here. */
async function main(): Promise<number> {
  const { values } = parseArgs({ options: { email: { type: 'string' }, revoke: { type: 'boolean', default: false } } });
  if (!values.email) {
    console.error(USAGE);
    return 1;
  }
  const config = loadConfig(process.env);
  await connectDb(config.mongodbUri);
  try {
    await ensureSystemRoles();
    const user = await User.findOne({ email: normalizeEmail(values.email) });
    if (!user) {
      console.error(`No user with email ${values.email}; register first`);
      return 1;
    }
    // Anyone can register an address they do not own; only a verified one may be made admin.
    if (!values.revoke && !user.emailVerified) {
      console.error(`${values.email} is not verified; the account must verify its email first`);
      return 1;
    }
    user.platformRoleId = values.revoke ? null : (await systemRole('super_admin'))._id;
    await user.save();
    console.log(values.revoke ? `${values.email} is no longer a platform admin` : `${values.email} is now a Super admin`);
    return 0;
  } finally {
    await disconnectDb();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
