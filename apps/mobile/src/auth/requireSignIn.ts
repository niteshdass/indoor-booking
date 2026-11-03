import { safeNext } from './safeNext';

/** Sends a signed-out player to sign-in; they come back to `next` (an in-app path) afterwards. */
export function requireSignIn(router: { push(href: never): void }, next: string): void {
  router.push(`/sign-in?next=${encodeURIComponent(safeNext(next))}` as never);
}
