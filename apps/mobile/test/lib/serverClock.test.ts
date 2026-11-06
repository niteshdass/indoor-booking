import { apiGet } from '../../src/lib/api';
import { noteServerDate, resetServerClock, serverNow } from '../../src/lib/serverClock';

afterEach(() => resetServerClock());

describe('server clock', () => {
  it('learns how far the server is ahead from the Date header', () => {
    const local = Date.parse('2026-11-06T10:00:00.000Z');
    // The server says 10:05:00 while the phone says 10:00:00.
    noteServerDate('Fri, 06 Nov 2026 10:05:00 GMT', local, local);
    expect(serverNow(local)).toBe(Date.parse('2026-11-06T10:05:00.500Z'));
  });

  it('keeps the device clock when the difference is only header rounding and network time', () => {
    const local = Date.parse('2026-11-06T10:00:00.200Z');
    noteServerDate('Fri, 06 Nov 2026 10:00:01 GMT', local, local);
    expect(serverNow(local)).toBe(local);
  });

  it('ignores a missing or broken header', () => {
    const local = Date.now();
    noteServerDate(null, local, local);
    noteServerDate('soon', local, local);
    expect(serverNow(local)).toBe(local);
  });

  it('is learned from every API answer', async () => {
    const ahead = new Date(Date.now() + 10 * 60_000).toUTCString();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ Date: ahead }), json: async () => ({}) }) as unknown as typeof fetch;
    await apiGet('/x');
    const gap = serverNow() - Date.now();
    expect(gap).toBeGreaterThan(9 * 60_000);
    expect(gap).toBeLessThan(11 * 60_000);
  });
});
