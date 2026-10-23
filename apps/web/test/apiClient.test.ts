import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiGet } from '../src/lib/apiClient';

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('apiClient', () => {
  it('returns parsed JSON on 2xx', async () => {
    mockFetch(200, { status: 'ok', db: 'up' });
    await expect(apiGet('/health')).resolves.toEqual({ status: 'ok', db: 'up' });
  });
  it('throws ApiError with server code', async () => {
    mockFetch(409, { error: { code: 'slot_taken', message: 'Slot taken' } });
    await expect(apiGet('/x')).rejects.toMatchObject({ status: 409, code: 'slot_taken' });
  });
  it('maps network failure to network_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed')));
    await expect(apiGet('/x')).rejects.toMatchObject({ code: 'network_error' });
  });
});
