/** Leaves the app for a gateway's hosted page. Its own module so tests can stub it (jsdom's location cannot be). */
export function leaveTo(url: string): void {
  window.location.assign(url);
}
