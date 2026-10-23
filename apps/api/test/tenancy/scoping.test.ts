import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { tenantScoped } from '../../src/tenancy/tenantScoped.plugin';
import { tenantRepo } from '../../src/tenancy/repo';
import type { TenantContext } from '../../src/tenancy/context';
import { Membership } from '../../src/tenancy/membership.model';
import { AppError } from '../../src/errors';

const { ObjectId } = mongoose.Schema.Types;
const widgetSchema = new mongoose.Schema({
  ownerId: { type: ObjectId, required: true },
  venueId: { type: ObjectId },
  name: String,
});
widgetSchema.plugin(tenantScoped);
const Widget = mongoose.model('Widget', widgetSchema);

const oid = () => new mongoose.Types.ObjectId().toString();
const A = oid();
const B = oid();
const V1 = oid();
const V2 = oid();

function tenant(ownerId: string, venueIds: TenantContext['venueIds'] = 'all'): TenantContext {
  return {
    ownerId,
    userId: oid(),
    membershipId: oid(),
    roleId: oid(),
    roleKey: 'owner',
    permissions: new Set(),
    venueIds,
  };
}

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(async () => {
  await Widget.deleteMany({}).setOptions({ crossTenant: true });
});

describe('tenantScoped plugin', () => {
  it('unscoped queries throw', async () => {
    const id = oid();
    const attempts: Promise<unknown>[] = [
      Widget.find({}).exec(),
      Widget.findOne({ name: 'a' }).exec(),
      Widget.findById(id).exec(),
      Widget.updateMany({}, { name: 'b' }).exec(),
      Widget.countDocuments().exec(),
      Widget.aggregate([{ $match: { name: 'a' } }]).exec(),
      Membership.find({}).exec(),
    ];
    for (const p of attempts) await expect(p).rejects.toThrow('Tenant filter missing');
  });

  it('crossTenant opt-out works', async () => {
    await expect(Widget.find({}).setOptions({ crossTenant: true })).resolves.toEqual([]);
  });

  it('saving a loaded document works; doc.deleteOne is rejected', async () => {
    const w = await Widget.create({ ownerId: A, name: 'a' });
    w.name = 'b';
    await w.save();
    expect((await Widget.findOne({ _id: w._id, ownerId: A }))?.name).toBe('b');
    await expect(w.deleteOne()).rejects.toThrow('Tenant filter missing');
  });

  it('scoped aggregate passes', async () => {
    await expect(Widget.aggregate([{ $match: { ownerId: new mongoose.Types.ObjectId(A) } }])).resolves.toEqual([]);
  });
});

describe('tenantRepo', () => {
  it('repo only sees own owner', async () => {
    await Widget.create({ ownerId: A, name: 'a' });
    const bw = await Widget.create({ ownerId: B, name: 'b' });
    const repo = tenantRepo(Widget, tenant(A));
    expect((await repo.find()).map((w) => w.name)).toEqual(['a']);
    expect(await repo.findById(bw.id as string)).toBeNull();
    expect((await repo.updateOne({ _id: bw._id }, { name: 'x' })).modifiedCount).toBe(0);
    expect((await repo.find({ ownerId: B })).map((w) => w.name)).toEqual(['a']);
    expect(await repo.countDocuments()).toBe(1);
  });

  it('repo.create stamps ownerId', async () => {
    const repo = tenantRepo(Widget, tenant(A));
    const w = await repo.create({ ownerId: B, name: 'c' });
    expect(String(w.ownerId)).toBe(A);
    const stored = await Widget.findOne({ _id: w._id, ownerId: A });
    expect(stored?.name).toBe('c');
  });

  it('venue scope filters reads and blocks writes', async () => {
    await Widget.create({ ownerId: A, venueId: V1, name: 'v1' });
    const w2 = await Widget.create({ ownerId: A, venueId: V2, name: 'v2' });
    const repo = tenantRepo(Widget, tenant(A, [V1]), { venueField: 'venueId' });
    expect((await repo.find()).map((w) => w.name)).toEqual(['v1']);
    expect(await repo.findById(w2.id as string)).toBeNull();
    const err = await repo.create({ venueId: V2, name: 'no' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 404, code: 'not_found' });
    await expect(repo.create({ venueId: V1, name: 'yes' })).resolves.toMatchObject({ name: 'yes' });
  });

  it('malformed id → null', async () => {
    expect(await tenantRepo(Widget, tenant(A)).findById('nope')).toBeNull();
  });
});
