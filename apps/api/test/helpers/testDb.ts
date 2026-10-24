import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connectDb, disconnectDb } from '../../src/db';

const START_ATTEMPTS = 5;

let replSet: MongoMemoryReplSet | undefined;

const portInUse = (err: unknown) => err instanceof Error && /already in use/.test(err.message);

/**
 * Parallel test workers each pick a free port, and two can pick the same one before either binds
 * it; on that clash, start again on a fresh port. `port` pins the first attempt (tests only).
 */
export async function createReplSet(port?: number): Promise<MongoMemoryReplSet> {
  for (let i = 1; ; i++) {
    try {
      return await MongoMemoryReplSet.create({
        replSet: { count: 1 },
        instanceOpts: i === 1 && port !== undefined ? [{ port }] : [],
      });
    } catch (err) {
      if (!portInUse(err) || i >= START_ATTEMPTS) throw err;
    }
  }
}

export async function startTestDb(): Promise<void> {
  replSet = await createReplSet();
  await connectDb(replSet.getUri());
}

export async function stopTestDb(): Promise<void> {
  await disconnectDb();
  await replSet?.stop();
  replSet = undefined;
}
