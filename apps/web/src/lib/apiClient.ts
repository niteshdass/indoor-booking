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

/** A file download: the body as a blob, named by the server's Content-Disposition (else the path's last segment). */
export type Download = { blob: Blob; filename: string };

/** `filename="…"` or RFC 5987 `filename*=UTF-8''…` from a Content-Disposition header; the starred form wins. */
export function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const starred = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  if (starred) {
    try {
      return decodeURIComponent(starred[1]!.trim());
    } catch {
      // fall through to the plain form
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/.exec(disposition);
  const name = (plain?.[1] ?? plain?.[2])?.trim();
  return name || null;
}

async function fetchFile(path: string, token: string | null): Promise<Download> {
  let res: Response;
  try {
    res = await fetch(BASE_URL + path, {
      headers: { Accept: 'text/csv, application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Network request failed');
  }
  if (!res.ok) {
    // Errors are the API's usual JSON body, not a file.
    const err = ((await res.json().catch(() => undefined)) as ErrorBody | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? 'network_error', err?.message ?? `Request failed with status ${res.status}`, err?.details);
  }
  let blob: Blob;
  try {
    blob = await res.blob();
  } catch {
    throw new ApiError(0, 'network_error', 'Network request failed');
  }
  const fallback = path.split('?')[0]!.split('/').pop() || 'download';
  return { blob, filename: filenameFrom(res.headers.get('Content-Disposition')) ?? fallback };
}

/** Retries `run` once with a fresh token when an authenticated call answers 401 with a refreshable code. */
async function withRefresh<T>(path: string, run: (token: string | null) => Promise<T>): Promise<T> {
  const token = accessToken;
  try {
    return await run(token);
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
      if (fresh) return run(fresh);
    }
    throw err;
  }
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return withRefresh(path, (token) => send<T>(path, init, token));
}

/** GET a file (CSV export) with the same token and one-shot refresh as JSON calls; a failure throws `ApiError`. */
export function apiDownload(path: string): Promise<Download> {
  return withRefresh(path, (token) => fetchFile(path, token));
}

/** Hands a downloaded blob to the browser as a saved file. */
export function saveDownload({ blob, filename }: Download): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // Revoked on the next tick so the browser has started the save.
  setTimeout(() => URL.revokeObjectURL(url), 0);
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

/** POST a file as the raw request body, typed by the blob's own type. */
export function apiUpload<T>(path: string, blob: Blob): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': blob.type },
    body: blob,
  });
}
