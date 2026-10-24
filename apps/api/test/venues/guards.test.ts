import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Types } from 'mongoose';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { seedVenue } from '../helpers/venues';
import { runInTransaction } from '../../src/db';
import type { TenantContext } from '../../src/tenancy/context';
import { lockVenue } from '../../src/venues/guards';
import { Venue } from '../../src/venues/venue.model';

beforeAll(async () => {
  await startTestDb();
  await Venue.init();
});
afterAll(stopTestDb);

const ctxFor = (ownerId: string): TenantContext => ({
  ownerId,
  userId: new Types.ObjectId().toString(),
  membershipId: new Types.ObjectId().toString(),
  roleId: new Types.ObjectId().toString(),
  roleKey: 'owner',
  permissions: new Set(),
  venueIds: 'all',
});

describe('lockVenue', () => {
  it('404s when the venue was deleted after the route looked it up', async () => {
    const ownerId = new Types.ObjectId().toString();
    const venue = await seedVenue(ownerId);
    await Venue.deleteOne({ ownerId, _id: venue._id });
    await expect(
      runInTransaction((session) => lockVenue(ctxFor(ownerId), venue.id as string, new Date(), session)),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('locks an existing venue', async () => {
    const ownerId = new Types.ObjectId().toString();
    const venue = await seedVenue(ownerId);
    await expect(
      runInTransaction((session) => lockVenue(ctxFor(ownerId), venue.id as string, new Date(), session)),
    ).resolves.toBeUndefined();
  });
});
