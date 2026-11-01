import type { Response } from 'supertest';

/** The refresh token a response set in its `rt` cookie, or undefined when it set none. */
export function refreshCookie(res: Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const rt = cookies.find((c) => c.startsWith('rt='));
  const value = rt?.slice(3).split(';')[0];
  return value ? decodeURIComponent(value) : undefined;
}
