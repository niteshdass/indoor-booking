/** Returns `raw` only when it is a same-origin absolute path; anything else falls back to '/'. */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  try {
    return new URL(raw, window.location.origin).origin === window.location.origin ? raw : '/';
  } catch {
    return '/';
  }
}
