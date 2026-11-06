export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// e.g. http://192.168.x.x:4000/api/v1 (a device cannot reach the dev machine as localhost).
// Set per profile in eas.json. A release build made without it talks to production, never to the phone
// itself; a dev build falls back to localhost (simulator) and says so.
const PRODUCTION_API_URL = 'https://bookaturf.vercel.app/api/v1';
function baseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;
  if (!__DEV__) return PRODUCTION_API_URL;
  console.warn('EXPO_PUBLIC_API_URL is not set: using http://localhost:4000/api/v1, which a real device cannot reach.');
  return 'http://localhost:4000/api/v1';
}
const BASE_URL: string = baseUrl();

type ErrorBody = { error?: { code?: string; message?: string; details?: unknown } };

let accessToken: string | null = null;
let refreshHandler: (() => Promise<string | null>) | null = null;

/** The access token lives in memory only; it is never written to storage. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Called once on a 401 for an authenticated request; resolves a fresh access token, or null when signed out. */
export function setRefreshHandler(fn: (() => Promise<string | null>) | null): void {
  refreshHandler = fn;
}

const REFRESHABLE_CODES = ['invalid_token', 'unauthenticated'];

/** A request still unanswered after this long fails like a dropped connection instead of spinning forever. */
export const REQUEST_TIMEOUT_MS = 20_000;

async function send<T>(path: string, init: RequestInit | undefined, token: string | null): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(BASE_URL + path, {
        ...init,
        signal: controller.signal,
        // Native clients authenticate with bearer/body tokens; cookies are never used.
        credentials: 'omit',
        headers: {
          Accept: 'application/json',
          'X-Client': 'native',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init?.headers,
        },
      });
    } catch {
      throw new ApiError(0, 'network_error', 'Network request failed');
    }

    const body: unknown = await res.json().catch(() => undefined);
    // The body stalled past the timeout: what arrived can't be trusted as the answer.
    if (controller.signal.aborted) throw new ApiError(0, 'network_error', 'Network request timed out');
    if (!res.ok) {
      const err = (body as ErrorBody | undefined)?.error;
      throw new ApiError(
        res.status,
        err?.code ?? 'network_error',
        err?.message ?? `Request failed with status ${res.status}`,
        err?.details,
      );
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Retries once with a fresh token when an authenticated call answers 401 with a refreshable code. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = accessToken;
  try {
    return await send<T>(path, init, token);
  } catch (err) {
    if (
      err instanceof ApiError &&
      err.status === 401 &&
      REFRESHABLE_CODES.includes(err.code) &&
      token &&
      !path.startsWith('/auth/') &&
      refreshHandler
    ) {
      const fresh = await refreshHandler();
      if (fresh) return send<T>(path, init, fresh);
    }
    throw err;
  }
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** DELETE answers 204 with no body. */
export async function apiDelete(path: string): Promise<void> {
  await request<undefined>(path, { method: 'DELETE' });
}
