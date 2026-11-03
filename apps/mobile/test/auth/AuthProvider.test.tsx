import { Text } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AuthProvider } from '../../src/auth/AuthProvider';
import { useAuth } from '../../src/auth/useAuth';
import { apiGet, setAccessToken } from '../../src/lib/api';

const json = (status: number, body?: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const user = { id: 'u1', name: 'A', email: 'a@b.c', emailVerified: true, phone: null, hasPassword: true, hasGoogle: false, platformAdmin: false };

let ctx: ReturnType<typeof useAuth>;
function Probe() {
  ctx = useAuth();
  return <Text>{ctx.status}</Text>;
}

const getItem = SecureStore.getItemAsync as jest.Mock;
const setItem = SecureStore.setItemAsync as jest.Mock;
const delItem = SecureStore.deleteItemAsync as jest.Mock;
const fetchMock = jest.fn();

const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  fetchMock.mockReset();
  getItem.mockReset().mockResolvedValue(null);
  setItem.mockClear();
  delItem.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  setAccessToken(null);
});

describe('AuthProvider', () => {
  it('two concurrent 401s trigger exactly one refresh', async () => {
    getItem.mockResolvedValue('rt1');
    let refreshes = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, { user, accessToken: `at${refreshes + 1}`, refreshToken: `rt${refreshes + 1}` });
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer at1' ? json(401, { error: { code: 'invalid_token' } }) : json(200, { ok: auth });
    });
    // The boot refresh (first call) yields at1; `refreshes` then counts only the refreshes caused by 401s.
    fetchMock.mockImplementationOnce(async () => json(200, { user, accessToken: 'at1', refreshToken: 'rt1b' }));
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(ctx.status).toBe('signedIn'));
    const results = await Promise.all([apiGet('/a'), apiGet('/b')]);
    expect(results).toEqual([{ ok: 'Bearer at2' }, { ok: 'Bearer at2' }]);
    expect(urls().filter((u) => u.endsWith('/auth/refresh'))).toHaveLength(2); // boot + one for both 401s
    expect(refreshes).toBe(1);
  });

  it('refresh 401 signs out and clears SecureStore', async () => {
    getItem.mockResolvedValue('rt1');
    fetchMock.mockResolvedValue(json(401, { error: { code: 'token_reused' } }));
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(ctx.status).toBe('signedOut'));
    expect(delItem).toHaveBeenCalledWith('rt');
  });

  it('no stored token at boot is signedOut without a request', async () => {
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(ctx.status).toBe('signedOut'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refresh network error at boot gives status offline and keeps the stored token', async () => {
    getItem.mockResolvedValue('rt1');
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(ctx.status).toBe('offline'));
    expect(delItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('keeps the rotated refresh token in memory when the SecureStore write fails', async () => {
    getItem.mockResolvedValue('rt1');
    setItem.mockRejectedValueOnce(new Error('keychain locked'));
    const bodies: unknown[] = [];
    let n = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        bodies.push(JSON.parse(init.body as string));
        n += 1;
        return json(200, { user, accessToken: `at${n}`, refreshToken: n === 1 ? 'rt1b' : 'rt1c' });
      }
      return json(401, { error: { code: 'invalid_token' } });
    });
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(ctx.status).toBe('signedIn'));
    expect(delItem).not.toHaveBeenCalled();
    // A 401 forces a second refresh, which must present the rotated token, not the spent one.
    await expect(apiGet('/x')).rejects.toBeDefined();
    expect(bodies).toEqual([{ refreshToken: 'rt1' }, { refreshToken: 'rt1b' }]);
    expect(ctx.status).toBe('signedIn');
  });

  it('signIn stores the refresh token', async () => {
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(ctx.status).toBe('signedOut'));
    await act(async () => ctx.signIn({ user, accessToken: 'a', refreshToken: 'r' }));
    expect(ctx.status).toBe('signedIn');
    expect(setItem).toHaveBeenCalledWith('rt', 'r');
  });

  it('signOut posts /auth/logout with the stored token and clears it even if the call fails', async () => {
    getItem.mockResolvedValue('rt1');
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/auth/refresh') ? json(200, { user, accessToken: 'a', refreshToken: 'rt2' }) : Promise.reject(new TypeError('down')),
    );
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(ctx.status).toBe('signedIn'));
    getItem.mockResolvedValue('rt2');
    await act(async () => ctx.signOut());
    const logout = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/auth/logout'))!;
    expect(JSON.parse(logout[1].body)).toEqual({ refreshToken: 'rt2' });
    expect(delItem).toHaveBeenCalledWith('rt');
    expect(ctx.status).toBe('signedOut');
    expect(screen.getByText('signedOut')).toBeTruthy();
  });
});
