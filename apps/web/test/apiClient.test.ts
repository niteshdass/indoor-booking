import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiGet, apiPost, apiPatch, setAccessToken, setRefreshHandler } from '../src/lib/apiClient';
import { mockApi, type Call } from './helpers/api';

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

describe('apiClient auth', () => {
  afterEach(() => {
    setAccessToken(null);
    setRefreshHandler(null);
  });

  it('sends bearer token when set', async () => {
    const { calls } = mockApi([{ path: '/me', body: {} }]);
    setAccessToken('abc');
    await apiGet('/me');
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer abc');
  });

  it('auth paths include credentials', async () => {
    const { calls } = mockApi([{ method: 'POST', path: '/auth/refresh', body: {} }, { path: '/search', body: {} }]);
    await apiPost('/auth/refresh', {});
    await apiGet('/search');
    expect(calls[0]!.credentials).toBe('include');
    expect(calls[1]!.credentials).not.toBe('include');
  });

  it('401 refreshes once and retries', async () => {
    const { calls } = mockApi([
      {
        path: '/me/bookings',
        body: (_c: Call, n: number) => (n === 0 ? { status: 401, body: { error: { code: 'invalid_token', message: 'x' } } } : { bookings: [] }),
      },
    ]);
    const refresh = vi.fn().mockResolvedValue('new');
    setAccessToken('old');
    setRefreshHandler(refresh);
    await expect(apiGet('/me/bookings')).resolves.toEqual({ bookings: [] });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers.get('authorization')).toBe('Bearer new');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refresh failure rethrows', async () => {
    mockApi([{ path: '/me', status: 401, body: { error: { code: 'invalid_token', message: 'x' } } }]);
    setAccessToken('old');
    setRefreshHandler(vi.fn().mockResolvedValue(null));
    await expect(apiGet('/me')).rejects.toMatchObject({ name: 'ApiError', status: 401 });
  });

  it('no refresh without a token', async () => {
    mockApi([{ path: '/me', status: 401, body: { error: { code: 'unauthenticated', message: 'x' } } }]);
    const refresh = vi.fn().mockResolvedValue('new');
    setRefreshHandler(refresh);
    await expect(apiGet('/me')).rejects.toMatchObject({ status: 401 });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('apiPatch sends PATCH with JSON', async () => {
    const { calls } = mockApi([{ method: 'PATCH', path: '/me', body: { ok: true } }]);
    await expect(apiPatch('/me', { name: 'A' })).resolves.toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { name: 'A' } });
    expect(calls[0]!.headers.get('content-type')).toBe('application/json');
  });
});
