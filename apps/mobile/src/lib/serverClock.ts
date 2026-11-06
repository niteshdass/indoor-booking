/**
 * How far the server's clock is ahead of this device's (ms), learned from the `Date` header of API answers. Hold
 * countdowns end at a server instant, so a phone whose clock is a few minutes off would otherwise show the wrong time
 * left, or offer Pay after the hold has gone.
 */
let skew = 0;

/** Below this the header's one-second resolution and network time are all the difference: keep the device clock. */
const NOISE_MS = 2_000;

/** Records the server's clock from an answer's `Date` header, read against the middle of the request. */
export function noteServerDate(header: string | null, sentAt: number, receivedAt: number): void {
  const server = header ? Date.parse(header) : NaN;
  if (Number.isNaN(server)) return;
  // The header is truncated to the second: on average the true time is half a second later.
  const offset = server + 500 - (sentAt + receivedAt) / 2;
  skew = Math.abs(offset) < NOISE_MS ? 0 : offset;
}

/** The server's idea of now, from a device time (default: this moment). */
export function serverNow(local = Date.now()): number {
  return local + skew;
}

/** For tests. */
export function resetServerClock(): void {
  skew = 0;
}
