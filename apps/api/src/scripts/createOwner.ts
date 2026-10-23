import { parseArgs } from 'node:util';
import { LOCALES, type Locale } from '@booking/shared';
import { loadConfig } from '../config';
import { connectDb, disconnectDb } from '../db';
import { normalizeEmail } from '../auth/normalize';
import { User } from '../auth/user.model';
import { ensureSystemRoles } from '../tenancy/role.model';
import { createOwner } from '../tenancy/createOwner';

const USAGE =
  'Usage: pnpm --filter api create-owner --email <registered email> --name <name> --country <XX> --currency <XXX> [--locale en|ru]';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      country: { type: 'string' },
      currency: { type: 'string' },
      locale: { type: 'string' },
    },
  });
  const { email, name, country, currency, locale } = values;
  if (!email || !name || !country || !currency) {
    console.error(USAGE);
    return 1;
  }
  if (locale !== undefined && !(LOCALES as readonly string[]).includes(locale)) {
    console.error(`Locale must be one of: ${LOCALES.join(', ')}`);
    return 1;
  }
  const config = loadConfig(process.env);
  await connectDb(config.mongodbUri);
  try {
    await ensureSystemRoles();
    const user = await User.findOne({ email: normalizeEmail(email) });
    if (!user) {
      console.error(`No user with email ${email}; register first`);
      return 1;
    }
    const { owner } = await createOwner(
      { userId: user.id as string, name, country, currency, locale: locale as Locale | undefined },
      new Date(),
    );
    console.log(`Owner ${owner.name} created: ${owner.id as string}`);
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
