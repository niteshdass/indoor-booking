/**
 * Returns `raw` only when it is an in-app path (one leading `/`, no scheme, no `//` or `/\`); else '/'.
 * Same rule as apps/web/src/auth/safeNext.ts, minus the `window.location` origin check (there is no origin here).
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}
