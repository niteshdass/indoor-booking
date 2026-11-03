import { safeNext } from './safeNext';

type Nav = { canGoBack?(): boolean; dismissTo(href: never): void; replace(href: never): void };

/**
 * Leaves the sign-in screens after a successful sign-in. When a screen sent the player here (`requireSignIn` pushes
 * sign-in with `next`) and it is still underneath, pop back to it: that screen keeps its state (the checkout's
 * Idempotency-Key, the pay screen's booking) and picks up the new auth by itself. Replacing would stack a second copy
 * on top of it. With nothing to go back to (a cold deep link to sign-in) `next` replaces the sign-in screen.
 */
export function returnAfterSignIn(router: Nav, rawNext: string | undefined): void {
  const next = safeNext(rawNext);
  if (rawNext && router.canGoBack?.()) router.dismissTo(next as never);
  else router.replace(next as never);
}
