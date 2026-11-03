import { ApiError, apiGet, apiPost, setAccessToken } from '../../src/lib/api';

const json = (status: number, body?: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('api client', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    setAccessToken(null);
  });

  it('sends X-Client native on every request', async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await apiGet('/venues');
    await apiPost('/auth/login', {});
    for (const call of fetchMock.mock.calls) {
      expect(call[1].headers['X-Client']).toBe('native');
      expect(call[1].credentials).toBe('omit');
    }
  });

  it('maps a network failure to ApiError network_error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fail'));
    await expect(apiGet('/x')).rejects.toMatchObject({ status: 0, code: 'network_error' });
    expect(ApiError).toBeDefined();
  });
});
