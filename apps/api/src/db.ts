import mongoose from 'mongoose';

export async function connectDb(uri: string): Promise<void> {
  await mongoose.connect(uri);
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export function dbState(): 'up' | 'down' {
  return mongoose.connection.readyState === 1 ? 'up' : 'down';
}

/** Runs fn inside a MongoDB transaction (requires a replica set). Commits on success, aborts on throw. */
export async function runInTransaction<T>(
  fn: (session: mongoose.ClientSession) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}
