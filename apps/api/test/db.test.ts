import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { dbState, runInTransaction } from '../src/db';
import { startTestDb, stopTestDb } from './helpers/testDb';

const Thing = mongoose.model('Thing', new mongoose.Schema({ key: { type: String, unique: true } }));

beforeAll(async () => {
  await startTestDb();
  await Thing.init();
});
afterAll(stopTestDb);

describe('db', () => {
  it('reports up when connected', () => {
    expect(dbState()).toBe('up');
  });

  it('commits a transaction', async () => {
    await runInTransaction(async (s) => {
      await Thing.create([{ key: 'a' }], { session: s });
    });
    expect(await Thing.countDocuments({ key: 'a' })).toBe(1);
  });

  it('rolls back every write when the function throws', async () => {
    await expect(
      runInTransaction(async (s) => {
        await Thing.create([{ key: 'b' }], { session: s });
        await Thing.create([{ key: 'b' }], { session: s }); // duplicate key
      }),
    ).rejects.toMatchObject({ code: 11000 });
    expect(await Thing.countDocuments({ key: 'b' })).toBe(0);
  });
});
