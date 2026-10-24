import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createReplSet } from './testDb';

describe('createReplSet', () => {
  let blocker: Server | undefined;

  afterEach(async () => {
    await new Promise((resolve) => (blocker ? blocker.close(resolve) : resolve(undefined)));
    blocker = undefined;
  });

  it('starts on another port when the first one is taken', async () => {
    blocker = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => blocker!.listen(0, '127.0.0.1', resolve));
    const taken = (blocker.address() as { port: number }).port;

    const replSet = await createReplSet(taken);
    try {
      expect(replSet.getUri()).not.toContain(`:${taken}/`);
    } finally {
      await replSet.stop();
    }
  });
});
