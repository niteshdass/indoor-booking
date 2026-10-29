import { InvalidCurrencyError, currencyExponent, type Locale, type OwnerStatus } from '@booking/shared';
import { AppError } from '../errors';
import { runInTransaction } from '../db';
import { Owner, type OwnerDoc } from './owner.model';
import { Membership, type MembershipDoc } from './membership.model';
import { systemRole } from './role.model';
import { logActivity } from './activityLog.model';

export type CreateOwnerInput = {
  userId: string;
  name: string;
  country: string;
  currency: string;
  locale?: Locale;
  /** Defaults to active; self-registered owners start pending_approval. */
  status?: OwnerStatus;
};

const invalidOwner = (message: string) => new AppError(400, 'invalid_owner', message);

function validate(input: CreateOwnerInput): void {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 100) throw invalidOwner('Name must be 1–100 characters');
  if (!/^[A-Z]{2}$/.test(input.country)) {
    throw invalidOwner('Country must be an ISO 3166-1 alpha-2 code, e.g. BD');
  }
  try {
    currencyExponent(input.currency);
  } catch (err) {
    if (err instanceof InvalidCurrencyError) throw invalidOwner(err.message);
    throw err;
  }
}

/** Creates an owner and the owner's own membership (owner role, all venues) in one transaction. */
export async function createOwner(
  input: CreateOwnerInput,
  now: Date,
): Promise<{ owner: OwnerDoc; membership: MembershipDoc }> {
  validate(input);
  const role = await systemRole('owner');
  return runInTransaction(async (session) => {
    const [owner] = await Owner.create(
      [
        {
          name: input.name.trim(),
          country: input.country,
          defaultCurrency: input.currency,
          defaultLocale: input.locale ?? 'en',
          status: input.status ?? 'active',
        },
      ],
      { session },
    );
    const [membership] = await Membership.create(
      [{ ownerId: owner!._id, userId: input.userId, roleId: role._id, allVenues: true }],
      { session },
    );
    const ownerId = owner!.id as string;
    await logActivity(
      { ownerId, userId: input.userId },
      {
        action: 'owner.create',
        entity: 'owner',
        entityId: ownerId,
        after: { name: owner!.name, country: owner!.country, defaultCurrency: owner!.defaultCurrency },
      },
      now,
      session,
    );
    return { owner: owner!, membership: membership! };
  });
}
