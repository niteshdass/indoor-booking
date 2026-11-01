import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from './helpers/testDb';
import { Payment } from '../src/bookings/payment.model';

beforeAll(async () => {
  await startTestDb();
  await Payment.init();
});
afterAll(stopTestDb);

/** Names every index the winning plan of `filter` scans; empty for a collection scan. */
async function indexesUsed(collection: mongoose.Collection, filter: Record<string, unknown>): Promise<string[]> {
  const plan = (await collection.find(filter).explain('queryPlanner')) as { queryPlanner: { winningPlan: unknown } };
  const names: string[] = [];
  const walk = (stage: unknown) => {
    if (!stage || typeof stage !== 'object') return;
    const s = stage as { indexName?: string; inputStage?: unknown; inputStages?: unknown[] };
    if (s.indexName) names.push(s.indexName);
    walk(s.inputStage);
    s.inputStages?.forEach(walk);
  };
  walk(plan.queryPlanner.winningPlan);
  return names;
}

describe('Payment indexes', () => {
  it('cross-tenant lookups by booking, kind and status use an index', async () => {
    const used = await indexesUsed(Payment.collection, {
      bookingId: { $in: [new mongoose.Types.ObjectId()] },
      kind: 'manual',
      status: 'pending',
    });
    expect(used).toContain('bookingId_1_kind_1_status_1');
  });
});
