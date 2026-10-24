import { vi } from 'vitest';

export type Call = {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
  credentials?: RequestCredentials;
};
export type Route = {
  method?: string;
  path: string | RegExp;
  status?: number;
  body?: unknown | ((call: Call, n: number) => unknown);
};

const API_PREFIX = '/api/v1';

/**
 * Stubs global fetch; `path` matches the URL path after `/api/v1`. First matching route wins; `n` counts that
 * route's hits from 0. Unmatched -> 599 + recorded in `unmatched`. A `body` function may return `{ status, body }`
 * to override `status` for that hit. Call `vi.unstubAllGlobals()` in `afterEach`.
 */
export function mockApi(routes: Route[]): { calls: Call[]; unmatched: Call[] } {
  const calls: Call[] = [];
  const unmatched: Call[] = [];
  const hits = new Map<Route, number>();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : url.pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      let body: unknown;
      if (typeof init?.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      const call: Call = {
        method,
        path,
        query: url.searchParams,
        body,
        headers: new Headers(init?.headers),
        credentials: init?.credentials,
      };
      calls.push(call);

      const route = routes.find(
        (r) =>
          (r.method === undefined || r.method.toUpperCase() === method) &&
          (typeof r.path === 'string' ? r.path === path : r.path.test(path)),
      );
      if (!route) {
        unmatched.push(call);
        return json(599, { error: { code: 'unmatched_route', message: `${method} ${path}` } });
      }
      const n = hits.get(route) ?? 0;
      hits.set(route, n + 1);
      let status = route.status ?? 200;
      let out = typeof route.body === 'function' ? (route.body as (c: Call, n: number) => unknown)(call, n) : route.body;
      if (typeof route.body === 'function' && out && typeof out === 'object' && 'status' in out && 'body' in out) {
        const o = out as { status: number; body: unknown };
        status = o.status;
        out = o.body;
      }
      return json(status, out);
    }),
  );
  return { calls, unmatched };
}

function json(status: number, body: unknown): Response {
  if (status === 204 || body === undefined) return new Response(null, { status });
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
