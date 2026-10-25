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

const BASE_URL: string = import.meta.env.VITE_API_URL ?? '/api/v1';

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

async function send<T>(path: string, init: RequestInit | undefined, token: string | null): Promise<T> {
  const isAuthPath = path.startsWith('/auth/');
  let res: Response;
  try {
    res = await fetch(BASE_URL + path, {
      ...init,
      ...(isAuthPath ? { credentials: 'include' as const } : {}),
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Network request failed');
  }

  const body: unknown = await res.json().catch(() => undefined);
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
}

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

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
